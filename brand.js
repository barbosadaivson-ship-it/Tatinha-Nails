/**
 * Branding Configuration
 * Customize these values to rebrand the app for different businesses.
 */
const BRAND_CONFIG = {
    name: "Tatinha Nails",
    // WhatsApp da Tati (Aguardando número correto)
    barberWhatsApp: "011971204073",
    colors: {
        primary: "#99CDD8",
        secondary: "#657166",
        background: "#DAEBE3",
        text: "#4A524A",
        accent: "#F3C3B2"
    },
    logo: "sparkles",
    bannerSlides: [
        {
            image: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&q=80&w=800",
            title: "Unhas Perfeitas",
            subtitle: "Cuidado e carinho em cada detalhe"
        },
        {
            image: "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&q=80&w=800",
            title: "Seu Momento de Beleza",
            subtitle: "Agende e relaxe com a Tatinha"
        }
    ],
    admin: {
        email: "tati@tatinhanails.com",
        password: "tati2026"
    },
    pix: {
        key: "011971204073",
        name: "Tatinha Nails"
    },
    services: [
        { id: 1, name: "Manicure", price: 25.00, duration: 90, icon: "hand" },
        { id: 2, name: "Pedicure", price: 30.00, duration: 90, icon: "footprints" },
        { id: 3, name: "Manicure + Pedicure", price: 50.00, duration: 90, icon: "sparkles" }
    ],
    barbers: [
        { id: 1, name: "Tati", role: "Nail Designer", photo: "https://i.pravatar.cc/150?u=tatinha" }
    ],
    // Horários de 30 em 30 min. Último slot viável para 1h30 é 16:30 (termina 18:00)
    times: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]
};

if (typeof module !== 'undefined') {
    module.exports = BRAND_CONFIG;
}
