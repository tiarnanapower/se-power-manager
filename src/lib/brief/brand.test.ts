import { describe, expect, it } from "vitest";
import { extractBrand, extractColours, extractFonts, inlineStyles, stylesheetLinks } from "@/lib/brief/brand";

const html = `<!doctype html><html><head><title>Fine Oak | Handmade furniture</title>
<meta property="og:site_name" content="Fine Oak"><meta name="description" content="Oak furniture made in Devon.">
<meta name="theme-color" content="#1a6b4a">
<link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato">
<link rel="icon" href="/favicon.png">
<style>:root{--brand-primary:#1a6b4a;--accent:#d97706} body{font-family:"Lato",Arial,sans-serif;color:#222} h1,h2{font-family:'Playfair Display',serif}
.a{color:#1a6b4a}.b{background:#1a6b4a}.c{background:#d97706}.d{background:#f7f5f0}.e{color:#ffffff}.f{color:#000}</style>
<script type="application/ld+json">{"@type":"Organization","name":"Fine Oak","telephone":"+44 1234 567890","email":"hello@fineoak.example","address":{"streetAddress":"1 Mill Lane","addressLocality":"Exeter","postalCode":"EX1 1AA","addressCountry":"UK"},"logo":"https://cdn.example/logo.svg"}</script>
</head><body><header><img class="site-logo" src="/img/logo.png" alt="Fine Oak"></header>
<nav><a href="/tables">Tables</a><a href="/chairs">Chairs</a><a href="/tables">Tables</a></nav>
<h1>Furniture built to last</h1><h2>Our story</h2>
<a href="https://www.instagram.com/fineoak">IG</a><a href="https://facebook.com/">home</a><a href="tel:+441234567890">call</a></body></html>`;

describe("brand extraction", () => {
  it("picks the brand colours by how the site uses them, and a neutral", () => {
    const colours = extractColours(html, "");

    expect(colours.find((colour) => colour.role === "primary")?.hex).toBe("#1A6B4A");
    expect(colours.find((colour) => colour.role === "secondary")?.hex).toBe("#D97706");
    expect(colours.find((colour) => colour.role === "neutral")?.hex).toBe("#F7F5F0");
    expect(colours.some((colour) => colour.hex === "#FFFFFF" || colour.hex === "#000000")).toBe(false);
  });

  it("reads rgb() colours and short hex, and falls back to a neutral when none is light", () => {
    const colours = extractColours("", ".a{color:rgb(200, 30, 30)}.b{color:rgb(200,30,30)}");

    expect(colours[0]).toMatchObject({ hex: "#C81E1E", role: "primary" });
    expect(colours.at(-1)).toMatchObject({ role: "neutral", hex: "#F5F5F5" });
  });

  it("reads hsl() colours", () => {
    expect(extractColours("", ".a{color:hsl(150, 60%, 25%)}.b{color:hsl(150,60%,25%)}")[0]).toMatchObject({ hex: "#1A6640", role: "primary" });
  });

  it("finds the heading and body fonts, ignoring generic ones", () => {
    expect(extractFonts(html, inlineStyles(html))).toMatchObject({ heading: "Playfair Display", body: "Lato" });
    expect(extractFonts("", "p{font-family:sans-serif}").all).toEqual([]);
    expect(extractFonts("", "body{font-family:'Apple Color Emoji',Menlo}h1{font-family:Geograph}").body).toBe("Geograph");
  });

  it("reads the name, logo, contact details, social links and navigation", () => {
    const brand = extractBrand(html, "https://www.fineoak.example/", inlineStyles(html));

    expect(brand.siteName).toBe("Fine Oak");
    expect(brand.description).toBe("Oak furniture made in Devon.");
    expect(brand.logo).toBe("https://www.fineoak.example/img/logo.png");
    expect(brand.contact).toEqual({ phone: "+44 1234 567890", email: "hello@fineoak.example", address: "1 Mill Lane, Exeter, EX1 1AA, UK" });
    expect(brand.social).toEqual([{ name: "Instagram", url: "https://www.instagram.com/fineoak" }]);
    expect(brand.nav).toEqual(["Tables", "Chairs"]);
    expect(brand.headings).toEqual(["Furniture built to last", "Our story"]);
  });

  it("offers no logo when the only image is a favicon", () => {
    expect(extractBrand('<title>x</title><link rel="icon" href="/f.png">', "https://x.example/").logo).toBeNull();
  });

  it("lists the stylesheets to read, leaving out font services", () => {
    expect(stylesheetLinks(html, "https://www.fineoak.example/")).toEqual(["https://www.fineoak.example/css/site.css"]);
  });
});
