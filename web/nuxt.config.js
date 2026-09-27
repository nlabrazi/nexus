// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: false },
    ssr: false,
    modules: ['@vite-pwa/nuxt'],
    app: {
        head: {
            title: 'Nexus - Mobile Bridge',
            meta: [
                { charset: 'utf-8' },
                {
                    name: 'viewport',
                    content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
                },
                { name: 'theme-color', content: '#090d16' },
                { name: 'apple-mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
                {
                    name: 'description',
                    content: 'Nexus Mobile Bridge - Coding Agents & Desktop Node Management',
                },
            ],
            link: [
                { rel: 'icon', type: 'image/png', href: '/pwa-icon.png' },
                { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
            ],
        },
    },
    pwa: {
        registerType: 'autoUpdate',
        manifest: {
            name: 'Nexus Mobile',
            short_name: 'Nexus',
            description: 'Private bridge for vscode coding agents',
            theme_color: '#090d16',
            background_color: '#090d16',
            display: 'standalone',
            orientation: 'portrait-primary',
            icons: [
                {
                    src: '/pwa-icon.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any maskable',
                },
            ],
        },
        client: {
            installPrompt: true,
        },
        workbox: {
            navigateFallback: '/',
        },
    },
});
//# sourceMappingURL=nuxt.config.js.map