export interface Section {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export const SECTIONS: Section[] = [
  {
    id: "hero",
    name: "Hero",
    description: "Large banner with headline, subtext, and CTA",
    prompt: "a hero section with a bold headline, supporting subtext, and a call-to-action button",
  },
  {
    id: "features",
    name: "Features",
    description: "Grid of feature cards with icons",
    prompt: "a features section with 3-4 cards, each with an icon, title, and description",
  },
  {
    id: "pricing",
    name: "Pricing",
    description: "Pricing tiers with feature comparison",
    prompt: "a pricing section with 3 tiers (Free, Pro, Enterprise) showing features and prices",
  },
  {
    id: "testimonials",
    name: "Testimonials",
    description: "Customer quotes and reviews",
    prompt: "a testimonials section with 3 customer quotes, names, and roles",
  },
  {
    id: "faq",
    name: "FAQ",
    description: "Accordion-style frequently asked questions",
    prompt: "an FAQ section with 5-6 collapsible question/answer items",
  },
  {
    id: "contact",
    name: "Contact Form",
    description: "Contact form with name, email, and message",
    prompt: "a contact section with a form (name, email, message fields) and a submit button",
  },
  {
    id: "gallery",
    name: "Gallery",
    description: "Image grid or portfolio showcase",
    prompt: "a gallery section with a responsive grid of image placeholders with hover effects",
  },
  {
    id: "team",
    name: "Team",
    description: "Team member cards with photos and bios",
    prompt: "a team section with 3-4 member cards showing photo placeholder, name, role, and short bio",
  },
  {
    id: "stats",
    name: "Stats / Numbers",
    description: "Key metrics displayed prominently",
    prompt: "a stats section with 3-4 large numbers with labels (e.g. '10K+ Users', '99.9% Uptime')",
  },
  {
    id: "cta",
    name: "CTA Banner",
    description: "Full-width call-to-action banner",
    prompt: "a full-width CTA banner with a compelling headline and action button, with a contrasting background",
  },
  {
    id: "footer",
    name: "Footer",
    description: "Footer with links, social icons, and copyright",
    prompt: "a footer with link columns, social media icons, and copyright text",
  },
  {
    id: "navbar",
    name: "Navigation Bar",
    description: "Top nav with logo and menu links",
    prompt: "a fixed navigation bar with logo/brand name, menu links, and a mobile hamburger menu",
  },
];
