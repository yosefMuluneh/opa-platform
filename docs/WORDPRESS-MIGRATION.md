# WordPress migration

1. Back up the WordPress database and full `wp-content/uploads` directory.
2. Export pages, posts, categories, tags and relevant custom post types.
3. Inventory sitemap, URLs/slugs, SEO metadata, authors, images and internal links.
4. Map WordPress posts/pages to CMS records and media to storage records.
5. Preserve slugs, dates, alt text, captions and attribution where possible.
6. Do not migrate themes, plugin code, passwords or obsolete accounts.
7. Create a 301 redirect map for changed URLs.
8. Reconcile content counts, test images and links, and compare important URLs.
9. Run a final incremental migration immediately before DNS cutover.
10. Keep the old WordPress hosting available during the rollback window.

Do not change MX, SPF, DKIM or DMARC records during website cutover unless the mail provider explicitly requires it.
