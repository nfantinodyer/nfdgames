#!/usr/bin/env python3
"""
NFDGames Blog Generator
=======================
Generates high-quality, SEO-optimized blog posts for www.nfdgames.com
using the Anthropic Claude API (or OpenAI as fallback).

Usage:
    # Generate all posts:
    python generate_blogs.py

    # Generate a specific post by slug:
    python generate_blogs.py --slug transfer-files-android-to-pc-without-usb

    # Generate posts in a range (for batching):
    python generate_blogs.py --start 0 --count 10

    # Dry run (preview topics without generating):
    python generate_blogs.py --dry-run

    # Use OpenAI instead of Anthropic:
    python generate_blogs.py --provider openai

Environment variables:
    ANTHROPIC_API_KEY - Your Anthropic API key (for Claude)
    OPENAI_API_KEY    - Your OpenAI API key (if using --provider openai)
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from html import escape

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
TOPICS_FILE = SCRIPT_DIR / "topics.json"
TEMPLATE_FILE = SCRIPT_DIR / "post-template.html"
OUTPUT_DIR = SCRIPT_DIR / "posts"
INDEX_FILE = SCRIPT_DIR / "index.html"
SITEMAP_FILE = SCRIPT_DIR.parent / "sitemap.xml"
SITE_URL = "https://www.nfdgames.com"

# Rate-limiting: pause between API calls to avoid hitting limits
API_DELAY_SECONDS = 2

# ---------------------------------------------------------------------------
# LLM Prompt — This is the core quality control
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a professional technical writer for NFDGames, an indie software studio. \
You write blog posts about file transfer, device connectivity, and the OpenDrop app. \

Your writing style:
- Clear, direct, and genuinely helpful
- Written for real humans, not search engines
- Technically accurate with practical, actionable advice
- Conversational but professional — no filler, no fluff
- Uses concrete examples and step-by-step instructions where appropriate
- Naturally incorporates relevant keywords without stuffing
- Includes personal insights and real-world scenarios

Quality standards (CRITICAL — Google's helpful content guidelines):
- Every paragraph must add real value. No padding or repetition.
- Include specific, actionable information that readers can immediately use
- When comparing tools, be honest and fair — acknowledge trade-offs
- When discussing OpenDrop, be informative but not overly promotional
- Include technical details that demonstrate genuine expertise
- Write content that a knowledgeable human would find useful and accurate
- Avoid generic advice that could apply to anything — be specific

OpenDrop context (use naturally where relevant):
- Free AirDrop alternative for Windows, Linux, Android, iOS
- Wireless file transfer — no cables, no cloud, no file size limits on LAN
- Uses mDNS for automatic device discovery on local networks
- Remote transfers via Cloudflare tunnels (Pro feature)
- End-to-end encrypted with TLS 1.3
- Available as desktop GUI app and CLI tool
- QR code pairing for quick device connection
- Available on Microsoft Store, App Store, Google Play
- Built with Python + FastAPI (desktop) and Flutter (mobile)
"""

ARTICLE_PROMPT_TEMPLATE = """\
Write a comprehensive, genuinely informative blog post with the following details:

Title: {title}
Category: {category}
Target keywords: {keywords}
Brief: {description}

Requirements:
1. Write 1200-2000 words of substantive content
2. Use HTML formatting (h2, h3, p, ul/ol/li, strong, code, blockquote tags)
3. Include 4-6 H2 section headings that are descriptive and useful
4. Include a brief table of contents at the top as an ordered list inside a div with class="toc"
5. Where relevant, include a practical tip box using: <div class="callout callout-tip"><div class="callout-title">Tip</div><p>...</p></div>
6. If the topic involves steps, use numbered lists with clear instructions
7. Naturally mention OpenDrop where relevant, but don't force it — the article should stand on its own as useful content
8. End with a brief conclusion paragraph
9. Write a compelling meta description (under 160 characters) for SEO
10. Estimate reading time in minutes

IMPORTANT:
- Do NOT include the H1 title — that's handled by the template
- Do NOT include any markdown — output pure HTML
- Do NOT wrap the content in <article> or <html> tags
- Start directly with the table of contents div, then the content

Return your response as a JSON object with these exact keys:
{{
  "meta_description": "...",
  "read_time": 7,
  "content": "<div class=\\"toc\\">...",
  "faq": [
    {{"question": "...", "answer": "..."}},
    {{"question": "...", "answer": "..."}}
  ]
}}

Include 2-4 FAQ items relevant to the article topic. These will be used for FAQ schema markup.
"""


# ---------------------------------------------------------------------------
# API Clients
# ---------------------------------------------------------------------------

def call_anthropic(prompt: str, system: str) -> str:
    """Call the Anthropic Claude API."""
    try:
        import anthropic
    except ImportError:
        print("ERROR: 'anthropic' package not installed. Run: pip install anthropic")
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable not set.")
        print("  export ANTHROPIC_API_KEY='your-key-here'")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def call_openai(prompt: str, system: str) -> str:
    """Call the OpenAI API."""
    try:
        import openai
    except ImportError:
        print("ERROR: 'openai' package not installed. Run: pip install openai")
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY environment variable not set.")
        print("  export OPENAI_API_KEY='your-key-here'")
        sys.exit(1)

    client = openai.OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=4096,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content


# ---------------------------------------------------------------------------
# Content Generation
# ---------------------------------------------------------------------------

def generate_article(topic: dict, provider: str) -> dict:
    """Generate a single blog article using the LLM API."""
    prompt = ARTICLE_PROMPT_TEMPLATE.format(
        title=topic["title"],
        category=topic["category"],
        keywords=", ".join(topic["keywords"]),
        description=topic["description"],
    )

    if provider == "anthropic":
        raw = call_anthropic(prompt, SYSTEM_PROMPT)
    elif provider == "openai":
        raw = call_openai(prompt, SYSTEM_PROMPT)
    else:
        raise ValueError(f"Unknown provider: {provider}")

    # Extract JSON from response (handle markdown code blocks)
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if json_match:
        raw = json_match.group(1)
    else:
        # Try to find raw JSON object
        json_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if json_match:
            raw = json_match.group(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  WARNING: Failed to parse JSON response: {e}")
        print(f"  Raw response (first 500 chars): {raw[:500]}")
        # Return a minimal fallback
        data = {
            "meta_description": topic["description"][:160],
            "read_time": 7,
            "content": f"<p>{escape(raw[:2000])}</p>",
            "faq": [],
        }

    return data


# ---------------------------------------------------------------------------
# HTML Assembly
# ---------------------------------------------------------------------------

def build_faq_schema(faqs: list) -> str:
    """Build FAQ schema JSON-LD fragment."""
    if not faqs:
        return ""

    faq_entries = []
    for faq in faqs:
        faq_entries.append(
            f'{{"@type":"Question","name":{json.dumps(faq["question"])},'
            f'"acceptedAnswer":{{"@type":"Answer","text":{json.dumps(faq["answer"])}}}}}'
        )

    return (
        ',\n        {\n'
        '          "@type": "FAQPage",\n'
        f'          "mainEntity": [{",".join(faq_entries)}]\n'
        '        }'
    )


def build_related_posts(current_slug: str, current_category: str, all_topics: list) -> str:
    """Build HTML for 2 related posts based on category match."""
    related = [
        t for t in all_topics
        if t["slug"] != current_slug and t["category"] == current_category
    ]
    # If not enough same-category, add others
    if len(related) < 2:
        related += [
            t for t in all_topics
            if t["slug"] != current_slug and t not in related
        ]

    html_parts = []
    for t in related[:2]:
        html_parts.append(
            f'<a href="/blog/posts/{t["slug"]}.html" class="related-card">\n'
            f'    <h4>{escape(t["title"])}</h4>\n'
            f'    <p>{escape(t["description"][:100])}</p>\n'
            f'</a>'
        )
    return "\n".join(html_parts)


def build_og_tags(keywords: list) -> str:
    """Build Open Graph keyword tags."""
    return "\n    ".join(
        f'<meta property="article:tag" content="{escape(kw)}">'
        for kw in keywords
    )


def assemble_post(topic: dict, article_data: dict, template: str, all_topics: list, publish_date: str) -> str:
    """Assemble a complete blog post HTML from template + generated content."""
    categories = {
        "tutorial": "tutorial",
        "guide": "guide",
        "comparison": "comparison",
        "tips": "tips",
        "news": "news",
    }

    tag_class = categories.get(topic["category"], "guide")
    category_labels = {
        "tutorial": "Tutorial",
        "guide": "Guide",
        "comparison": "Comparison",
        "tips": "Tips & Tricks",
        "news": "News",
    }
    category_label = category_labels.get(topic["category"], "Guide")

    # Truncate title for breadcrumb
    title_short = topic["title"]
    if len(title_short) > 50:
        title_short = title_short[:47] + "..."

    # Keywords as JSON for schema
    keywords_json = ", ".join(f'"{escape(k)}"' for k in topic["keywords"])

    # Date formatting
    date_display = datetime.strptime(publish_date, "%Y-%m-%d").strftime("%B %d, %Y")

    replacements = {
        "{{TITLE}}": escape(topic["title"]),
        "{{TITLE_SHORT}}": escape(title_short),
        "{{META_DESCRIPTION}}": escape(article_data.get("meta_description", topic["description"][:160])),
        "{{SLUG}}": topic["slug"],
        "{{CATEGORY}}": category_label,
        "{{TAG_CLASS}}": tag_class,
        "{{DATE_ISO}}": publish_date,
        "{{DATE_DISPLAY}}": date_display,
        "{{READ_TIME}}": str(article_data.get("read_time", 7)),
        "{{KEYWORDS_JSON}}": keywords_json,
        "{{OG_TAGS}}": build_og_tags(topic["keywords"]),
        "{{FAQ_SCHEMA}}": build_faq_schema(article_data.get("faq", [])),
        "{{CONTENT}}": article_data.get("content", ""),
        "{{RELATED_POSTS}}": build_related_posts(topic["slug"], topic["category"], all_topics),
    }

    html = template
    for placeholder, value in replacements.items():
        html = html.replace(placeholder, value)

    return html


# ---------------------------------------------------------------------------
# Blog Index Page Generator
# ---------------------------------------------------------------------------

def generate_index_page(topics: list, categories: dict):
    """Generate the blog index page listing all published posts."""
    # Check which posts have been generated
    published = []
    for topic in topics:
        post_file = OUTPUT_DIR / f"{topic['slug']}.html"
        if post_file.exists():
            published.append(topic)

    if not published:
        print("  No published posts found. Generate some posts first.")
        return

    # Build filter tags
    active_categories = sorted(set(t["category"] for t in published))
    filter_tags_html = '<button class="filter-tag active" data-filter="all">All</button>\n'
    for cat in active_categories:
        label = categories.get(cat, {}).get("label", cat.title())
        filter_tags_html += f'            <button class="filter-tag" data-filter="{cat}">{label}</button>\n'

    # Build blog cards
    cards_html = ""
    for topic in published:
        cat_info = categories.get(topic["category"], {})
        tag_class = cat_info.get("tag_class", "guide")
        label = cat_info.get("label", topic["category"].title())

        cards_html += f'''        <a href="/blog/posts/{topic["slug"]}.html" class="blog-card" data-category="{topic["category"]}">
            <div class="blog-card-meta">
                <span class="blog-card-tag {tag_class}">{label}</span>
                <span class="blog-card-date">2026</span>
            </div>
            <h2>{escape(topic["title"])}</h2>
            <p>{escape(topic["description"])}</p>
            <span class="blog-card-read">
                Read article
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </span>
        </a>
'''

    index_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blog – File Transfer Tips, Tutorials &amp; Guides | NFDGames</title>
    <meta name="description" content="Explore tutorials, guides, and tips about wireless file transfer, OpenDrop, and cross-platform file sharing. Learn how to transfer files between any device.">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
    <meta name="author" content="NFDGames">
    <link rel="icon" type="image/png" href="/NFDGamesLogoCircleTransparent.png">
    <link rel="canonical" href="{SITE_URL}/blog/" />
    <link rel="alternate" hreflang="en" href="{SITE_URL}/blog/" />

    <meta property="og:type" content="website">
    <meta property="og:title" content="Blog – File Transfer Tips, Tutorials &amp; Guides | NFDGames">
    <meta property="og:description" content="Tutorials, guides, and tips about wireless file transfer and OpenDrop.">
    <meta property="og:image" content="{SITE_URL}/NFDGamesLogoCircleTransparent.png">
    <meta property="og:url" content="{SITE_URL}/blog/">
    <meta property="og:site_name" content="NFDGames">

    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Blog – File Transfer Tips &amp; Guides | NFDGames">
    <meta name="twitter:description" content="Tutorials, guides, and tips about wireless file transfer and OpenDrop.">
    <meta name="twitter:image" content="{SITE_URL}/NFDGamesLogoCircleTransparent.png">

    <script type="application/ld+json">
    {{
      "@context": "https://schema.org",
      "@graph": [
        {{
          "@type": "CollectionPage",
          "name": "NFDGames Blog",
          "description": "Tutorials, guides, and tips about wireless file transfer and OpenDrop.",
          "url": "{SITE_URL}/blog/",
          "publisher": {{
            "@type": "Organization",
            "name": "NFDGames",
            "url": "{SITE_URL}/"
          }}
        }},
        {{
          "@type": "BreadcrumbList",
          "itemListElement": [
            {{ "@type": "ListItem", "position": 1, "name": "NFDGames", "item": "{SITE_URL}/" }},
            {{ "@type": "ListItem", "position": 2, "name": "Blog", "item": "{SITE_URL}/blog/" }}
          ]
        }}
      ]
    }}
    </script>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Sora:wght@300;400;500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
    <noscript><link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Sora:wght@300;400;500;600;700&display=swap" rel="stylesheet"></noscript>

    <link rel="stylesheet" href="/styles/common.css">
    <link rel="stylesheet" href="/styles/blog.css">

    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-17319823241"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      gtag('config', 'AW-17319823241');
    </script>
</head>
<body>
    <div class="bg-gradient"></div>
    <div class="noise"></div>

    <nav>
        <a href="/" class="logo">
            <picture>
                <source srcset="/NFDGamesLogoCircleTransparent.webp" type="image/webp">
                <img src="/NFDGamesLogoCircleTransparent.png" alt="NFDGames Icon" class="logo-icon" width="36" height="36" loading="lazy">
            </picture>
            NFDGames
        </a>
        <div class="nav-links">
            <a href="/#projects">Projects</a>
            <a href="/blog/">Blog</a>
            <a href="/OpenDrop/" class="nav-cta">Get OpenDrop</a>
        </div>
    </nav>

    <main>
    <section class="blog-hero">
        <h1>File Transfer <span class="gradient">Blog</span></h1>
        <p class="hero-subtitle">Tutorials, tips, and guides for transferring files between any device. Learn about wireless file sharing, OpenDrop, and more.</p>
    </section>

    <div class="blog-controls">
        <input type="text" class="blog-search" placeholder="Search articles..." id="blogSearch">
        <div class="blog-filter-tags">
            {filter_tags_html}
        </div>
    </div>

    <section class="blog-grid" id="blogGrid">
{cards_html}
    </section>
    </main>

    <footer>
        <div class="footer-content">
            <div class="footer-brand">
                <a href="/" class="logo">
                    <picture>
                        <source srcset="/NFDGamesLogoCircleTransparent.webp" type="image/webp">
                        <img src="/NFDGamesLogoCircleTransparent.png" alt="NFDGames Icon" class="logo-icon" width="36" height="36" loading="lazy">
                    </picture>
                    NFDGames
                </a>
                <p>Indie studio building software utilities and mobile games.</p>
            </div>
            <div class="footer-links">
                <div class="footer-col">
                    <h4>Products</h4>
                    <a href="/OpenDrop/">OpenDrop</a>
                    <a href="/OpenDrop/support.html">Support</a>
                </div>
                <div class="footer-col">
                    <h4>Resources</h4>
                    <a href="/blog/">Blog</a>
                    <a href="/OpenDrop/PrivacyPolicy.html">Privacy Policy</a>
                    <a href="/OpenDrop/TermsOfService.html">Terms of Service</a>
                </div>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; 2026 NFDGames. All rights reserved.</p>
        </div>
    </footer>

    <script src="/scripts/common.js"></script>
    <script>
    // Blog search and filter
    document.addEventListener('DOMContentLoaded', function() {{
        const search = document.getElementById('blogSearch');
        const grid = document.getElementById('blogGrid');
        const cards = grid.querySelectorAll('.blog-card');
        const filterTags = document.querySelectorAll('.filter-tag');
        let activeFilter = 'all';

        function filterCards() {{
            const query = search.value.toLowerCase().trim();
            cards.forEach(card => {{
                const text = card.textContent.toLowerCase();
                const category = card.dataset.category;
                const matchesSearch = !query || text.includes(query);
                const matchesFilter = activeFilter === 'all' || category === activeFilter;
                card.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
            }});
        }}

        search.addEventListener('input', filterCards);

        filterTags.forEach(tag => {{
            tag.addEventListener('click', function() {{
                filterTags.forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                activeFilter = this.dataset.filter;
                filterCards();
            }});
        }});
    }});
    </script>
    <script type="module">
      import {{ initializeApp }} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
      import {{ getAnalytics }} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
      const app = initializeApp({{
        apiKey: "AIzaSyD1XfHr0OtAM4Zm62sPLW4Rjg__8HlLE0c",
        authDomain: "opendrop-3c111.firebaseapp.com",
        projectId: "opendrop-3c111",
        storageBucket: "opendrop-3c111.firebasestorage.app",
        messagingSenderId: "573883707762",
        appId: "1:573883707762:web:e68643cce07c2cee3eadeb",
        measurementId: "G-ENWJJ78E3Q"
      }});
      getAnalytics(app);
    </script>
</body>
</html>'''

    INDEX_FILE.write_text(index_html)
    print(f"  Blog index page generated with {len(published)} posts.")


# ---------------------------------------------------------------------------
# Sitemap Generator
# ---------------------------------------------------------------------------

def update_sitemap(topics: list):
    """Update sitemap.xml to include all published blog posts."""
    # Read existing sitemap entries (non-blog)
    existing_entries = []
    if SITEMAP_FILE.exists():
        content = SITEMAP_FILE.read_text()
        # Extract existing URLs that are NOT blog posts
        for match in re.finditer(r"<url>(.*?)</url>", content, re.DOTALL):
            entry = match.group(1)
            if "/blog/" not in entry:
                existing_entries.append(f"   <url>{entry}</url>")

    # Add blog index
    today = datetime.now().strftime("%Y-%m-%d")
    blog_entries = [
        f"   <url>\n"
        f"      <loc>{SITE_URL}/blog/</loc>\n"
        f"      <lastmod>{today}</lastmod>\n"
        f"      <changefreq>weekly</changefreq>\n"
        f"      <priority>0.8</priority>\n"
        f"   </url>"
    ]

    # Add individual blog posts
    for topic in topics:
        post_file = OUTPUT_DIR / f"{topic['slug']}.html"
        if post_file.exists():
            blog_entries.append(
                f"   <url>\n"
                f"      <loc>{SITE_URL}/blog/posts/{topic['slug']}.html</loc>\n"
                f"      <lastmod>{today}</lastmod>\n"
                f"      <changefreq>monthly</changefreq>\n"
                f"      <priority>0.6</priority>\n"
                f"   </url>"
            )

    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(existing_entries)
        + "\n"
        + "\n".join(blog_entries)
        + "\n</urlset>\n"
    )

    SITEMAP_FILE.write_text(sitemap)
    total_blog = len([t for t in topics if (OUTPUT_DIR / f"{t['slug']}.html").exists()])
    print(f"  Sitemap updated: {len(existing_entries)} existing + {total_blog + 1} blog entries.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate SEO blog posts for NFDGames")
    parser.add_argument("--provider", choices=["anthropic", "openai"], default="anthropic",
                        help="LLM provider to use (default: anthropic)")
    parser.add_argument("--slug", type=str, help="Generate a single post by slug")
    parser.add_argument("--start", type=int, default=0, help="Start index for batch generation")
    parser.add_argument("--count", type=int, default=0, help="Number of posts to generate (0=all)")
    parser.add_argument("--dry-run", action="store_true", help="List topics without generating")
    parser.add_argument("--skip-existing", action="store_true", default=True,
                        help="Skip posts that already exist (default: true)")
    parser.add_argument("--regenerate", action="store_true",
                        help="Regenerate posts even if they already exist")
    parser.add_argument("--index-only", action="store_true",
                        help="Only regenerate the blog index page and sitemap")
    args = parser.parse_args()

    # Load topics
    with open(TOPICS_FILE) as f:
        data = json.load(f)

    topics = data["topics"]
    categories = data["categories"]

    # Index-only mode
    if args.index_only:
        print("Regenerating blog index and sitemap...")
        generate_index_page(topics, categories)
        update_sitemap(topics)
        print("Done!")
        return

    # Dry run
    if args.dry_run:
        print(f"Found {len(topics)} topics:\n")
        for i, t in enumerate(topics):
            existing = "EXISTS" if (OUTPUT_DIR / f"{t['slug']}.html").exists() else "      "
            print(f"  [{existing}] {i:3d}. [{t['category']:12s}] {t['title']}")
        print(f"\nTotal: {len(topics)} topics")
        existing_count = sum(1 for t in topics if (OUTPUT_DIR / f"{t['slug']}.html").exists())
        print(f"Existing: {existing_count} | Remaining: {len(topics) - existing_count}")
        return

    # Load template
    template = TEMPLATE_FILE.read_text()

    # Filter topics
    if args.slug:
        topics_to_generate = [t for t in topics if t["slug"] == args.slug]
        if not topics_to_generate:
            print(f"ERROR: No topic found with slug '{args.slug}'")
            print("Available slugs:")
            for t in topics:
                print(f"  - {t['slug']}")
            sys.exit(1)
    else:
        topics_to_generate = topics[args.start:]
        if args.count > 0:
            topics_to_generate = topics_to_generate[:args.count]

    if args.regenerate:
        args.skip_existing = False

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Generate posts
    total = len(topics_to_generate)
    generated = 0
    skipped = 0
    failed = 0

    # Spread publish dates across recent weeks for natural-looking content
    base_date = datetime.now()
    date_offset = 0

    print(f"\nGenerating {total} blog posts using {args.provider}...\n")

    for i, topic in enumerate(topics_to_generate):
        output_file = OUTPUT_DIR / f"{topic['slug']}.html"

        # Skip existing
        if args.skip_existing and output_file.exists():
            print(f"  [{i+1}/{total}] SKIP (exists): {topic['title']}")
            skipped += 1
            continue

        print(f"  [{i+1}/{total}] Generating: {topic['title']}...")

        try:
            # Calculate a staggered publish date (spread posts across recent weeks)
            publish_date = (base_date - timedelta(days=date_offset)).strftime("%Y-%m-%d")
            date_offset += 2  # Space posts ~2 days apart

            # Generate article content via LLM
            article_data = generate_article(topic, args.provider)

            # Assemble HTML
            html = assemble_post(topic, article_data, template, topics, publish_date)

            # Write output file
            output_file.write_text(html)
            generated += 1
            print(f"           OK -> {output_file.name}")

            # Rate limiting
            if i < total - 1:
                time.sleep(API_DELAY_SECONDS)

        except Exception as e:
            failed += 1
            print(f"           FAILED: {e}")
            continue

    # Regenerate index page and sitemap
    print("\nUpdating blog index page...")
    generate_index_page(topics, categories)

    print("Updating sitemap...")
    update_sitemap(topics)

    # Summary
    print(f"\n{'='*50}")
    print(f"  Generation complete!")
    print(f"  Generated: {generated}")
    print(f"  Skipped:   {skipped}")
    print(f"  Failed:    {failed}")
    published_count = sum(1 for t in topics if (OUTPUT_DIR / (t["slug"] + ".html")).exists())
    print(f"  Total published posts: {published_count}")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()
