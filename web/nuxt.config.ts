export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  css: ["~/assets/nexus.css"],
  app: {
    head: {
      title: "Nexus",
      htmlAttrs: { lang: "fr" },
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
        },
        { name: "theme-color", content: "#0c1721" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
        {
          name: "description",
          content: "Vos projets et vos agents, à portée de main.",
        },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/nexus.svg" }],
    },
  },
});
