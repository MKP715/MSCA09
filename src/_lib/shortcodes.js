// Shortcodes: {% icon "name", "classes" %} and {% image "path", "alt", "sizes" %}.
import fs from "node:fs";
import path from "node:path";
import Image from "@11ty/eleventy-img";

const ICON_DIR = path.join(process.cwd(), "node_modules", "lucide-static", "icons");
const iconCache = new Map();

// Old names used in CSVs → Lucide names (Lucide renames icons now and then).
const ICON_ALIASES = {
  "calendar-days": "calendar-days",
  "map-location-dot": "map",
  "people-group": "users",
  "box-archive": "archive",
  "hand-holding-heart": "hand-heart",
  "tower-broadcast": "radio-tower",
  "universal-access": "accessibility",
  "file-lines": "file-text",
  "circle-question": "circle-help",
  "door-open": "door-open",
  "house": "house",
  home: "house",
  gavel: "gavel",
  landmark: "landmark",
  newspaper: "newspaper",
};

export function iconSvg(name, cls = "w-5 h-5", label = "") {
  const key = String(name || "circle").trim();
  const resolved = ICON_ALIASES[key] || key;
  let svg = iconCache.get(resolved);
  if (svg === undefined) {
    const file = path.join(ICON_DIR, `${resolved}.svg`);
    svg = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (!svg) console.warn(`[icon] unknown Lucide icon "${key}" — see https://lucide.dev/icons`);
    iconCache.set(resolved, svg);
  }
  if (!svg) svg = fs.readFileSync(path.join(ICON_DIR, "circle.svg"), "utf8");
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, "&quot;")}"` : `aria-hidden="true" focusable="false"`;
  return svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sclass="[^"]*"/, "")
    .replace(/\swidth="\d+"/, "")
    .replace(/\sheight="\d+"/, "")
    .replace("<svg", `<svg class="lucide ${cls}" ${a11y}`)
    .replace(/\n\s*/g, "")
    .trim();
}

export function registerShortcodes(eleventyConfig) {
  eleventyConfig.addShortcode("icon", (name, cls, label) => iconSvg(name, cls, label));
  eleventyConfig.addFilter("icon", (name, cls, label) => iconSvg(name, cls, label));

  eleventyConfig.addShortcode("year", () => String(new Date().getFullYear()));

  /**
   * Responsive, optimised image from a file in src/assets/img (or an absolute path).
   * {% image "src/assets/img/hero/coast.jpg", "Alt text", "100vw", "hero-img", "eager" %}
   */
  eleventyConfig.addAsyncShortcode(
    "image",
    async (src, alt = "", sizes = "100vw", cls = "", loading = "lazy", widths = [480, 800, 1200, 1600, 2400, 3200]) => {
      if (!src) return "";
      const metadata = await Image(src, {
        widths: [...new Set(widths)],
        formats: ["avif", "webp", "jpeg"],
        outputDir: path.join(eleventyConfig.directories?.output || "_site", "assets/img/gen/"),
        urlPath: "/assets/img/gen/",
        sharpJpegOptions: { quality: 78, progressive: true },
        sharpWebpOptions: { quality: 76 },
        sharpAvifOptions: { quality: 55 },
      });
      return Image.generateHTML(metadata, {
        alt,
        sizes,
        class: cls,
        loading,
        decoding: loading === "eager" ? "sync" : "async",
        ...(loading === "eager" ? { fetchpriority: "high" } : {}),
      });
    }
  );
}
