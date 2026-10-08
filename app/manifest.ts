import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Loro AI",
    short_name: "Loro AI",
    description: "Facturas y estimados por voz para contratistas.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f8f3",
    theme_color: "#ffb81a",
    lang: "es",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
