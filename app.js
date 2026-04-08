/**
 * Tatinha Nails – App de Agendamento
 * Manicure e Pedicure. Cada serviço dura 1h30.
 * Auto-skips professional step for single professional, auto-confirms,
 * saves client data, blocks booked slots, phone mask, WhatsApp real links.
 */

// ── State ──────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD3JbUNcnlArPTbxfs2XUPVZpXemulcc_4",
  authDomain: "barberapp-35055.firebaseapp.com",
  projectId: "barberapp-35055",
  storageBucket: "barberapp-35055.firebasestorage.app",
  messagingSenderId: "124503942608",
  appId: "1:124503942608:web:99319e90aafe06f229c5d5"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const state = {
    tenantId: 'tatinha',
    view: 'home',
    isAdminLoggedIn: false,
    adminSelectedDate: new Date().toISOString().split('T')[0],
    adminViewType: 'weekly',
    blockedSlots: [],
    booking: {
        service: null,
        barber: null,
        date: new Date().toISOString().split('T')[0],
        time: null,
        clientName: '',
        clientPhone: '',
        termsAccepted: false
    },
    appointments: [],
    isBookingInProgress: false,
    lastAddedAptId: null,
    sliderIndex: 0,
    sliderTimer: null
};

// ── Helpers ────────────────────────────────────
const tenantCol = (name) => db.collection('tenants').doc(state.tenantId).collection(name);
const hasSingleBarber = () => BRAND_CONFIG.barbers.length === 1;

/**
 * Returns all time slots that are occupied on a given date.
 * Each appointment blocks multiple consecutive slots based on its service duration.
 * Default duration is 90 min (3 slots of 30 min).
 */
function getBookedTimes(date) {
    const allTimes = BRAND_CONFIG.times;
    const bookedSet = new Set();

    // Block slots for each appointment based on duration
    state.appointments
        .filter(a => a.date === date && a.status !== 'rejected')
        .forEach(apt => {
            const svc = BRAND_CONFIG.services.find(s => s.name === apt.service);
            const duration = svc ? svc.duration : 90; // default 90 min
            const slotsNeeded = Math.ceil(duration / 30);
            const startIdx = allTimes.indexOf(apt.time);
            if (startIdx === -1) return;
            for (let i = 0; i < slotsNeeded && (startIdx + i) < allTimes.length; i++) {
                bookedSet.add(allTimes[startIdx + i]);
            }
        });

    // Block manually blocked slots
    state.blockedSlots
        .filter(b => b.date === date)
        .forEach(b => bookedSet.add(b.time));

    return [...bookedSet];
}

/**
 * Check if a time slot can fit a full service duration without overlapping.
 * Returns true if the slot and all required consecutive slots are free.
 */
function canFitService(date, time, duration) {
    const allTimes = BRAND_CONFIG.times;
    const slotsNeeded = Math.ceil(duration / 30);
    const startIdx = allTimes.indexOf(time);
    if (startIdx === -1) return false;

    // Check if there are enough remaining slots in the day
    if (startIdx + slotsNeeded > allTimes.length) return false;

    const bookedTimes = getBookedTimes(date);
    for (let i = 0; i < slotsNeeded; i++) {
        if (bookedTimes.includes(allTimes[startIdx + i])) return false;
    }
    return true;
}

function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${day} ${months[parseInt(month) - 1]}`;
}

function formatDateFull(dateStr) {
    const [year, month, day] = dateStr.split('-');
    const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    return `${day} de ${months[parseInt(month) - 1]}`;
}

function phoneMask(value) {
    let v = value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 7) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
    if (v.length > 2) return `(${v.slice(0,2)}) ${v.slice(2)}`;
    if (v.length > 0) return `(${v}`;
    return '';
}

function loadSavedClient() {
    try {
        const saved = localStorage.getItem('barberapp_client');
        if (saved) {
            const data = JSON.parse(saved);
            state.booking.clientName = data.name || '';
            state.booking.clientPhone = data.phone || '';
        }
    } catch(e) {}
}

function saveClient(name, phone) {
    try {
        localStorage.setItem('barberapp_client', JSON.stringify({ name, phone }));
    } catch(e) {}
}

function buildWhatsAppLink(apt) {
    const phone = BRAND_CONFIG.barberWhatsApp;
    const msg = encodeURIComponent(
        `📋 *Novo Agendamento!*\n\n` +
        `👤 Cliente: ${apt.client}\n` +
        `📱 WhatsApp: ${apt.phone}\n` +
        `✂️ Serviço: ${apt.service}\n` +
        `📅 Data: ${formatDateFull(apt.date)}\n` +
        `🕐 Horário: ${apt.time}\n` +
        `💰 Valor: R$ ${apt.price}\n\n` +
        `_Agendado pelo app ${BRAND_CONFIG.name}_`
    );
    return `https://wa.me/55${phone}?text=${msg}`;
}

// ── DOM ────────────────────────────────────────
const viewContainer = document.getElementById('view-container');
const shopNameElem = document.getElementById('shop-name');
const headerRight = document.getElementById('header-right');
const bottomNav = document.getElementById('bottom-nav');

// ── Init ───────────────────────────────────────
function init() {
    shopNameElem.textContent = BRAND_CONFIG.name;
    document.title = BRAND_CONFIG.name + " - Agendamento";

    loadSavedClient();

    if (localStorage.getItem('barberapp_admin') === 'true') {
        state.isAdminLoggedIn = true;
    }

    // Configura escuta em tempo real do Firestore
    tenantCol('appointments').onSnapshot(snap => {
        state.appointments = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Se estiver finalizando agendamento, não re-renderiza 'checkout' para não resetar o form
        if (state.isBookingInProgress && state.view === 'checkout') return;
        if (['calendar', 'checkout', 'success', 'myBookings', 'admin'].includes(state.view)) render();
    });

    tenantCol('blockedSlots').onSnapshot(snap => {
        state.blockedSlots = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (['calendar', 'admin'].includes(state.view)) render();
    });

    setupNav();
    navigate('home');
}

function setupNav() {
    const adminContainer = document.getElementById('dynamic-admin-btn');
    if (adminContainer) {
        if (state.isAdminLoggedIn) {
            adminContainer.innerHTML = `
                <button class="icon-btn" onclick="navigate('admin')" title="Painel">
                    <i data-lucide="layout-dashboard"></i>
                </button>
            `;
        } else {
            adminContainer.innerHTML = '';
        }
    }

    const navButtons = bottomNav.querySelectorAll('.nav-item');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-view');
            if (target === 'home') navigate('home');
            else if (target === 'myBookings') navigate('myBookings');
            else if (target === 'login') {
                navigate(state.isAdminLoggedIn ? 'admin' : 'login');
            }
            navButtons.forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    if (window.lucide) lucide.createIcons();
}

// ── Router ─────────────────────────────────────
function navigate(view) {
    if (view === 'admin' && !state.isAdminLoggedIn) view = 'login';
    // Clear slider timer when leaving home
    if (view !== 'home' && state.sliderTimer) {
        clearInterval(state.sliderTimer);
        state.sliderTimer = null;
    }
    state.view = view;
    render();
    if (view === 'home') initSlider();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Toast ──────────────────────────────────────
function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const iconMap = { success: 'check-circle', info: 'info', error: 'alert-circle' };
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i data-lucide="${iconMap[type] || 'check-circle'}"></i><span>${message}</span>`;
    document.body.appendChild(toast);
    lucide.createIcons({ nodes: [toast] });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('show'));
    });
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
}

// ── Stepper ────────────────────────────────────
function getSteps() {
    // Service is selected on home, so stepper is just: Horário → Confirmar
    return [
        { num: 1, label: 'Horário' },
        { num: 2, label: 'Confirmar' }
    ];
}

function renderStepper(currentStep) {
    const steps = getSteps();
    return `
        <div class="stepper">
            ${steps.map((s, i) => `
                <div class="stepper-step">
                    <div class="step-dot ${s.num === currentStep ? 'active' : s.num < currentStep ? 'completed' : ''}">
                        ${s.num < currentStep ? '✓' : s.num}
                    </div>
                    ${i < steps.length - 1 ? `<div class="step-line ${s.num < currentStep ? 'completed' : ''}"></div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

// ── Render Engine ──────────────────────────────
function render() {
    const views = {
        home: renderHome,
        services: renderServices,
        barbers: renderBarbers,
        calendar: renderCalendar,
        checkout: renderCheckout,
        success: renderSuccess,
        myBookings: renderMyBookings,
        login: renderLogin,
        admin: renderAdmin
    };
    viewContainer.innerHTML = (views[state.view] || renderHome)();
    if (window.lucide) lucide.createIcons();
}

// ═══════════════════════════════════════════════
//  VIEWS
// ═══════════════════════════════════════════════

function renderHome() {
    const slides = BRAND_CONFIG.bannerSlides || [];
    const idx = state.sliderIndex;

    const slidesHtml = slides.map((s, i) => `
        <div class="hero-slide ${i === idx ? 'active' : ''}" style="background-image: url('${s.image}')">
            <div class="hero-slide-overlay"></div>
            <div class="hero-slide-content">
                <h2>${s.title}</h2>
                <p>${s.subtitle}</p>
            </div>
        </div>
    `).join('');

    const dotsHtml = slides.map((_, i) => `
        <button class="slider-dot ${i === idx ? 'active' : ''}" onclick="goToSlide(${i})" aria-label="Slide ${i + 1}"></button>
    `).join('');

    return `
        <div class="fade-in">
            <div class="hero-slider" id="hero-slider">
                ${slidesHtml}
                <div class="slider-dots">${dotsHtml}</div>
                <button class="slider-arrow slider-prev" onclick="goToSlide(${(idx - 1 + slides.length) % slides.length})" aria-label="Anterior">
                    <i data-lucide="chevron-left"></i>
                </button>
                <button class="slider-arrow slider-next" onclick="goToSlide(${(idx + 1) % slides.length})" aria-label="Próximo">
                    <i data-lucide="chevron-right"></i>
                </button>
            </div>

            <h3 class="section-title">Nossos Serviços</h3>
            <div class="list-container">
                ${BRAND_CONFIG.services.map(s => `
                    <div class="list-item" onclick="selectQuickService(${s.id})">
                        <div class="item-info">
                            <div class="icon-wrap"><i data-lucide="${s.icon || 'sparkles'}"></i></div>
                            <div>
                                <h3>${s.name}</h3>
                                <span class="duration"><i data-lucide="clock" style="width:12px;height:12px;"></i> ${s.duration} min</span>
                            </div>
                        </div>
                        <span class="item-price">R$ ${s.price.toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

window.goToSlide = (idx) => {
    const slides = BRAND_CONFIG.bannerSlides || [];
    if (!slides.length) return;
    state.sliderIndex = (idx + slides.length) % slides.length;
    render();
    initSlider();
};

function initSlider() {
    const slides = BRAND_CONFIG.bannerSlides || [];
    if (slides.length <= 1) return;

    // Clear previous timer
    if (state.sliderTimer) clearInterval(state.sliderTimer);
    state.sliderTimer = setInterval(() => {
        state.sliderIndex = (state.sliderIndex + 1) % slides.length;
        render();
        initSlider();
    }, 4500);

    // Touch swipe support
    const el = document.getElementById('hero-slider');
    if (!el) return;
    let touchStartX = 0;
    el.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) {
            window.goToSlide(state.sliderIndex + (diff > 0 ? 1 : -1));
        }
    }, { passive: true });
}

function renderServices() {
    const step = 1;
    return `
        <div class="fade-in">
            ${renderStepper(step)}
            <button class="back-link" onclick="navigate('home')"><i data-lucide="chevron-left"></i> Voltar</button>
            <h2 class="view-title">Escolha o Serviço</h2>
            <p class="view-subtitle">O que vamos fazer hoje?</p>
            <div class="list-container">
                ${BRAND_CONFIG.services.map(s => `
                    <div class="list-item ${state.booking.service?.id === s.id ? 'selected' : ''}" onclick="selectService(${s.id})">
                        <div class="item-info">
                            <div class="icon-wrap"><i data-lucide="${s.icon || 'scissors'}"></i></div>
                            <div>
                                <h3>${s.name}</h3>
                                <span class="duration"><i data-lucide="clock" style="width:12px;height:12px;"></i> ${s.duration} min</span>
                            </div>
                        </div>
                        <span class="item-price">R$ ${s.price.toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
            <button class="btn-primary" ${!state.booking.service ? 'disabled' : ''} onclick="goAfterService()">
                Continuar <i data-lucide="arrow-right"></i>
            </button>
        </div>
    `;
}

function renderBarbers() {
    const step = 2;
    return `
        <div class="fade-in">
            ${renderStepper(step)}
            <button class="back-link" onclick="navigate('services')"><i data-lucide="chevron-left"></i> Voltar</button>
            <h2 class="view-title">Quem vai te atender?</h2>
            <p class="view-subtitle">Escolha seu profissional</p>
            <div class="barber-grid">
                ${BRAND_CONFIG.barbers.map(b => `
                    <div class="barber-card ${state.booking.barber?.id === b.id ? 'selected' : ''}" onclick="selectBarber(${b.id})">
                        <div class="avatar-wrap"><img src="${b.photo}" alt="${b.name}"></div>
                        <h3>${b.name}</h3>
                        <span class="role">${b.role}</span>
                    </div>
                `).join('')}
            </div>
            <button class="btn-primary" ${!state.booking.barber ? 'disabled' : ''} onclick="navigate('calendar')">
                Escolher Horário <i data-lucide="arrow-right"></i>
            </button>
        </div>
    `;
}

function renderCalendar() {
    const today = new Date().toISOString().split('T')[0];
    const bookedTimes = getBookedTimes(state.booking.date);
    const step = 1;
    const backView = 'home';
    const serviceDuration = state.booking.service ? state.booking.service.duration : 90;

    return `
        <div class="fade-in">
            ${renderStepper(step)}
            <button class="back-link" onclick="navigate('${backView}')"><i data-lucide="chevron-left"></i> Voltar</button>
            <h2 class="view-title">Data & Hora</h2>
            <p class="view-subtitle">Cada serviço dura 1h30. Escolha o melhor horário.</p>

            <div class="date-picker-custom">
                <input type="date" id="date-input" value="${state.booking.date}" min="${today}" onchange="updateDate(this.value)">
            </div>

            <h3 class="section-title">Horários Disponíveis</h3>
            <div class="time-grid">
                ${BRAND_CONFIG.times.map(t => {
                    const canFit = canFitService(state.booking.date, t, serviceDuration);
                    const isBooked = bookedTimes.includes(t);
                    const unavailable = !canFit || isBooked;
                    return `
                        <button class="time-slot ${state.booking.time === t ? 'selected' : ''} ${unavailable ? 'booked' : ''}" 
                            ${unavailable ? 'disabled' : ''} 
                            onclick="${unavailable ? '' : `selectTime('${t}')`}">
                            ${t}
                            ${unavailable ? '<span class="slot-label">Ocupado</span>' : ''}
                        </button>
                    `;
                }).join('')}
            </div>

            <button class="btn-primary" ${!state.booking.time ? 'disabled' : ''} onclick="navigate('checkout')">
                Continuar <i data-lucide="arrow-right"></i>
            </button>
        </div>
    `;
}

function renderCheckout() {
    const s = state.booking.service;
    const b = state.booking.barber;
    const step = 2;

    return `
        <div class="fade-in checkout-view">
            ${renderStepper(step)}
            <button class="back-link" onclick="navigate('calendar')"><i data-lucide="chevron-left"></i> Voltar</button>
            <h2 class="view-title">Confirmar Agendamento</h2>
            <p class="view-subtitle">Confira e finalize</p>

            <div class="summary-card">
                <div class="summary-row">
                    <span>Serviço</span>
                    <strong>${s.name}</strong>
                </div>
                ${!hasSingleBarber() ? `
                <div class="summary-row">
                    <span>Profissional</span>
                    <strong>${b.name}</strong>
                </div>` : ''}
                <div class="summary-row">
                    <span>Data & Hora</span>
                    <strong>${formatDate(state.booking.date)} às ${state.booking.time}</strong>
                </div>
                <div class="summary-divider"></div>
                <div class="summary-row total">
                    <span>Total</span>
                    <strong class="price">R$ ${s.price.toFixed(2)}</strong>
                </div>
            </div>

            <div class="form-group">
                <label>Seu Nome</label>
                <input type="text" id="client-name" placeholder="Como quer ser chamado?" value="${state.booking.clientName}" oninput="state.booking.clientName = this.value">
            </div>

            <div class="form-group">
                <label>WhatsApp</label>
                <input type="tel" id="client-phone" placeholder="(00) 00000-0000" value="${state.booking.clientPhone}" oninput="handlePhoneInput(this)" maxlength="15">
            </div>

            <div class="terms-card">
                <div class="terms-header">
                    <i data-lucide="alert-triangle"></i>
                    <span>Atenção às Regras</span>
                </div>
                <ul class="terms-list">
                    <li>Chegar com <strong>10 minutos</strong> de antecedência.</li>
                    <li>Em caso de imprevisto, avise com antecedência se for cancelar.</li>
                    <li>Sujeito a <strong>10% de multa</strong> caso não compareça sem aviso prévio.</li>
                </ul>
                <label class="terms-checkbox">
                    <input type="checkbox" id="terms-check" onchange="toggleFinishCard(this.checked)" ${state.booking.termsAccepted ? 'checked' : ''}>
                    <span>Li e concordo com os termos do agendamento</span>
                </label>
            </div>

            <button class="btn-primary" id="btn-finish" onclick="finishBooking()" ${!state.booking.termsAccepted ? 'disabled' : ''}>
                <i data-lucide="check-circle"></i>
                Finalizar Agendamento
            </button>
        </div>
    `;
}

function renderMyBookings() {
    const phoneDigits = state.booking.clientPhone ? state.booking.clientPhone.replace(/\D/g, '') : '';
    const todayStr = new Date().toISOString().split('T')[0];

    if (!phoneDigits) {
        return `
            <div class="fade-in my-bookings-view empty-state">
                <i data-lucide="calendar-search" class="empty-icon"></i>
                <h3>Identifique-se</h3>
                <p>Para ver seus agendamentos, faça pelo menos um agendamento com seu WhatsApp.</p>
                <button class="btn-primary" onclick="navigate('services')">
                    <i data-lucide="calendar-plus"></i> Agendar Agora
                </button>
            </div>
        `;
    }

    const myApts = state.appointments.filter(a => {
        const aptPhone = a.phone ? a.phone.replace(/\D/g, '') : '';
        return aptPhone === phoneDigits && a.status !== 'rejected';
    });

    const futureApts = myApts
        .filter(a => a.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    const pastApts = myApts
        .filter(a => a.date < todayStr)
        .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
        .slice(0, 10); // show last 10

    if (myApts.length === 0) {
        return `
            <div class="fade-in my-bookings-view empty-state">
                <i data-lucide="calendar-x" class="empty-icon"></i>
                <h3>Nenhum agendamento</h3>
                <p>Você ainda não possui agendamentos registrados.</p>
                <button class="btn-primary" onclick="navigate('services')">
                    <i data-lucide="calendar-plus"></i> Agendar Agora
                </button>
            </div>
        `;
    }

    const renderAptCard = (apt, isPast) => {
        const statusLabel = apt.status === 'confirmed' ? 'Confirmado' : 'Pendente';
        const statusClass = apt.status === 'confirmed' ? 'status-confirmed' : 'status-pending';
        const svcLower = apt.service.toLowerCase();
        const iconName = svcLower.includes('+') || svcLower.includes('manicure + pedicure') ? 'sparkles' : svcLower.includes('pedicure') ? 'footprints' : 'hand';
        return `
            <div class="booking-card ${isPast ? 'booking-past' : ''}">
                <div class="booking-card-header">
                    <div class="booking-card-icon"><i data-lucide="${iconName}"></i></div>
                    <div class="booking-card-info">
                        <h4>${apt.service}</h4>
                        <span>${formatDate(apt.date)} às ${apt.time}</span>
                    </div>
                    <span class="booking-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="booking-card-price">R$ ${Number(apt.price).toFixed(2)}</div>
                ${!isPast ? `
                <div class="booking-pix-section">
                    <p>Pague via Pix:</p>
                    <div class="pix-key-box" onclick="copyPix('${BRAND_CONFIG.pix.key}')">
                        <span>${BRAND_CONFIG.pix.key}</span>
                        <i data-lucide="copy"></i>
                    </div>
                </div>` : ''}
            </div>
        `;
    };

    return `
        <div class="fade-in my-bookings-view">
            <h2 class="view-title">Meus Agendamentos</h2>
            <p class="view-subtitle">Acompanhe seus horários e faça o pagamento</p>

            ${futureApts.length > 0 ? `
                <h3 class="section-title">📅 Próximos</h3>
                <div class="bookings-list">
                    ${futureApts.map(a => renderAptCard(a, false)).join('')}
                </div>
            ` : ''}

            ${pastApts.length > 0 ? `
                <h3 class="section-title" style="margin-top: 32px;">🕐 Anteriores</h3>
                <div class="bookings-list">
                    ${pastApts.map(a => renderAptCard(a, true)).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function renderSuccess() {
    const lastApt = state.lastAddedAptId 
        ? state.appointments.find(a => a.id === state.lastAddedAptId)
        : state.appointments[state.appointments.length - 1];
    
    const waLink = lastApt ? buildWhatsAppLink(lastApt) : '#';

    return `
        <div class="fade-in success-view">
            <div class="success-icon"><i data-lucide="check-circle"></i></div>
            <h2>Agendado!</h2>
            <p class="msg">Obrigado, <strong>${state.booking.clientName}</strong>!<br>Te esperamos dia <strong>${formatDate(state.booking.date)}</strong> às <strong>${state.booking.time}</strong>.</p>

            <a href="${waLink}" target="_blank" class="btn-whatsapp">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Enviar confirmação pelo WhatsApp
            </a>



            <button class="btn-primary" onclick="resetApp()">
                <i data-lucide="home"></i>
                Voltar ao Início
            </button>
        </div>
    `;
}

// ═══════════════════════════════════════════════
//  LOGIN & ADMIN
// ═══════════════════════════════════════════════

function renderLogin() {
    return `
        <div class="fade-in login-view">
            <div class="login-card">
                <div class="login-icon"><i data-lucide="shield-check"></i></div>
                <h2>Área do Admin</h2>
                <p class="login-subtitle">Acesse com suas credenciais</p>
                <div class="form-group">
                    <label>E-mail</label>
                    <input type="email" id="login-email" placeholder="seu@email.com" autocomplete="email">
                </div>
                <div class="form-group">
                    <label>Senha</label>
                    <div class="password-field">
                        <input type="password" id="login-password" placeholder="••••••••" autocomplete="current-password">
                        <button type="button" class="toggle-pass" onclick="togglePassword()">
                            <i data-lucide="eye" id="eye-icon"></i>
                        </button>
                    </div>
                </div>
                <button class="btn-primary" onclick="handleLogin()">
                    <i data-lucide="log-in"></i> Entrar
                </button>
                <p class="login-note"><i data-lucide="info" style="width:14px;height:14px;"></i> Acesso exclusivo para profissionais</p>
            </div>
        </div>
    `;
}

window.setAdminView = (type) => { state.adminViewType = type; render(); };
window.adminChangeDateByStr = (dateStr) => { state.adminSelectedDate = dateStr; render(); };
window.adminChangeMonth = (delta) => {
    const d = new Date(state.adminSelectedDate + 'T12:00:00');
    d.setMonth(d.getMonth() + delta);
    state.adminSelectedDate = d.toISOString().split('T')[0];
    render();
};
window.toggleBlockSlot = async (date, time) => {
    const current = state.blockedSlots.find(b => b.date === date && b.time === time);
    try {
        if(current) {
            await tenantCol('blockedSlots').doc(current.id).delete();
            showToast('Horário desbloqueado', 'info');
        } else {
            await tenantCol('blockedSlots').add({ date, time });
            showToast('Horário bloqueado', 'success');
        }
    } catch(e) {
        console.error("Erro ao bloquear slot", e);
        showToast('Erro de conexão.', 'error');
    }
};

window.setAdminView = (type) => { state.adminViewType = type; render(); };

function renderAdmin() {
    const isServices = state.adminViewType === 'services';
    const viewTabs = `
        <div class="calendar-tabs">
            <button class="${state.adminViewType === 'daily' ? 'active' : ''}" onclick="setAdminView('daily')">Dia</button>
            <button class="${state.adminViewType === 'weekly' ? 'active' : ''}" onclick="setAdminView('weekly')">Semana</button>
            <button class="${state.adminViewType === 'monthly' ? 'active' : ''}" onclick="setAdminView('monthly')">Mês</button>
            <button class="${isServices ? 'active' : ''}" onclick="setAdminView('services')">Serviços</button>
        </div>
    `;

    let contentHtml = '';
    if (state.adminViewType === 'daily') contentHtml = renderAdminDaily();
    else if (state.adminViewType === 'weekly') contentHtml = renderAdminWeekly();
    else if (state.adminViewType === 'services') contentHtml = renderAdminServices();
    else contentHtml = renderAdminMonthly();

    const title = isServices ? 'Serviços' : 'Agenda';
    const subtitle = isServices ? 'Gerencie preços e serviços' : 'Gerencie seus horários';

    return `
        <div class="fade-in admin-view">
            <div class="admin-header">
                <div>
                    <h2 class="view-title">${title}</h2>
                    <p class="view-subtitle" style="margin-bottom:0;">${subtitle}</p>
                </div>
            </div>
            ${viewTabs}
            ${contentHtml}

            <div style="margin-top: 32px; text-align: center;">
                <button class="btn-secondary" onclick="handleLogout()">
                    <i data-lucide="log-out" style="width:16px;height:16px;margin-right:6px;"></i> Sair
                </button>
            </div>
        </div>
    `;
}

function renderAdminServices() {
    const services = BRAND_CONFIG.services;
    const icons = ['scissors','user','brush','zap','eye','star','heart','droplet','sun','moon','smile','award','crown','sparkles','flame','feather'];
    const iconOptions = icons.map(ic => `<option value="${ic}">${ic}</option>`).join('');

    const rowsHtml = services.map(s => `
        <div class="admin-service-row admin-service-edit-row" id="svc-row-${s.id}">
            <div class="admin-svc-icon-select-wrap">
                <div class="admin-svc-icon-preview" id="icon-preview-${s.id}">
                    <i data-lucide="${s.icon || 'scissors'}" style="width:18px;height:18px;"></i>
                </div>
                <select class="admin-svc-icon-select" onchange="updateIconPreview(${s.id}, this.value)" aria-label="Ícone">
                    ${icons.map(ic => `<option value="${ic}" ${ic === (s.icon || 'scissors') ? 'selected' : ''}>${ic}</option>`).join('')}
                </select>
            </div>
            <div class="admin-svc-edit-fields">
                <input class="admin-svc-field-input name-input" type="text" value="${s.name}" placeholder="Nome" aria-label="Nome do serviço" id="svc-name-${s.id}">
                <div class="admin-svc-row-bottom">
                    <div class="admin-svc-dur-wrap">
                        <i data-lucide="clock" style="width:12px;height:12px;color:var(--text-muted);"></i>
                        <input class="admin-svc-field-input dur-input" type="number" value="${s.duration}" min="5" step="5" aria-label="Duração" id="svc-dur-${s.id}"> min
                    </div>
                    <div class="admin-svc-price-wrap">
                        <span class="admin-svc-currency">R$</span>
                        <input class="admin-svc-price-input" type="number" min="0" step="0.50" value="${s.price.toFixed(2)}" aria-label="Preço" id="svc-price-${s.id}">
                    </div>
                </div>
            </div>
            <div class="admin-svc-actions">
                <button class="admin-svc-save" onclick="updateService(${s.id})" title="Salvar">
                    <i data-lucide="check" style="width:15px;height:15px;"></i>
                </button>
                <button class="admin-svc-delete" onclick="removeService(${s.id})" aria-label="Remover ${s.name}" title="Remover">
                    <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                </button>
            </div>
        </div>
    `).join('');

    return `
        <div class="admin-services-panel">
            ${rowsHtml}

            <div class="admin-add-service-card" id="add-service-form">
                <h4 class="admin-add-title"><i data-lucide="plus-circle" style="width:16px;height:16px;"></i> Novo Serviço</h4>
                <div class="admin-add-fields">
                    <div class="form-group" style="margin-bottom:12px;">
                        <label>Nome do Serviço</label>
                        <input type="text" id="new-svc-name" placeholder="Ex: Corte Degradê" />
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label>Ícone</label>
                            <select id="new-svc-icon">
                                ${iconOptions}
                            </select>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label>Duração (min)</label>
                            <input type="number" id="new-svc-duration" placeholder="30" min="5" step="5" />
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label>Preço (R$)</label>
                        <input type="number" id="new-svc-price" placeholder="45.00" min="0" step="0.50" />
                    </div>
                </div>
                <button class="btn-primary" style="margin-top:16px;" onclick="addService()">
                    <i data-lucide="plus"></i> Adicionar Serviço
                </button>
            </div>
        </div>
    `;
}

function renderAdminDaily() {
    const selDate = state.adminSelectedDate;
    const today = new Date().toISOString().split('T')[0];
    const isToday = selDate === today;
    const dayApts = state.appointments.filter(a => a.date === selDate && a.status !== 'rejected');
    const allConfirmed = state.appointments.filter(a => a.date === selDate && a.status === 'confirmed').length;
    const allPending = state.appointments.filter(a => a.date === selDate && a.status === 'pending').length;

    const dateObj = new Date(selDate + 'T12:00:00');
    const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const dayOfWeek = weekDays[dateObj.getDay()];
    const dayNum = selDate.split('-')[2];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthLabel = monthNames[parseInt(selDate.split('-')[1]) - 1];

    // Build a map of which slots are occupied by which appointment (including duration)
    const slotAptMap = {}; // time -> apt
    const slotDurationMap = {}; // time -> true (occupied by duration continuation)
    dayApts.forEach(apt => {
        const svc = BRAND_CONFIG.services.find(s => s.name === apt.service);
        const duration = svc ? svc.duration : 90;
        const slotsNeeded = Math.ceil(duration / 30);
        const startIdx = BRAND_CONFIG.times.indexOf(apt.time);
        if (startIdx === -1) return;
        for (let i = 0; i < slotsNeeded && (startIdx + i) < BRAND_CONFIG.times.length; i++) {
            const slotTime = BRAND_CONFIG.times[startIdx + i];
            if (i === 0) {
                slotAptMap[slotTime] = apt;
            } else {
                slotDurationMap[slotTime] = apt;
            }
        }
    });

    const slotsHtml = BRAND_CONFIG.times.map(time => {
        const apt = slotAptMap[time];
        const durationApt = slotDurationMap[time];
        const isBlocked = state.blockedSlots.some(b => b.date === selDate && b.time === time);
        if (apt) {
            const statusClass = apt.status === 'confirmed' ? 'slot-confirmed' : 'slot-pending';
            return `
                <div class="agenda-block ${statusClass}" onclick="updateAppointmentStatus('${apt.id}', '${apt.status === 'confirmed' ? 'pending' : 'confirmed'}')" title="Clique para alternar status">
                    <div class="block-time">${time}</div>
                    <div class="block-client" title="${apt.client}">${apt.client.split(' ')[0]}</div>
                    <div class="block-service" title="${apt.service}">${apt.service}</div>
                </div>
            `;
        } else if (durationApt) {
            const statusClass = durationApt.status === 'confirmed' ? 'slot-confirmed' : 'slot-pending';
            return `
                <div class="agenda-block ${statusClass} slot-continuation" title="Continuação: ${durationApt.client} - ${durationApt.service}">
                    <div class="block-time">${time}</div>
                    <div class="block-client" style="opacity:0.6;">↕</div>
                    <div class="block-service" style="opacity:0.6;">${durationApt.service}</div>
                </div>
            `;
        } else if (isBlocked) {
            return `
                <div class="agenda-block block-blocked" onclick="toggleBlockSlot('${selDate}', '${time}')" title="Clique para desbloquear">
                    <div class="block-time">${time}</div>
                    <div class="block-client"><i data-lucide="lock" style="width:14px;height:14px;margin-top:2px;"></i></div>
                    <div class="block-service">Bloqueado</div>
                </div>
            `;
        } else {
            return `
                <div class="agenda-block block-free" onclick="toggleBlockSlot('${selDate}', '${time}')" title="Clique para bloquear">
                    <div class="block-time">${time}</div>
                    <div class="block-client">-</div>
                    <div class="block-service">Livre</div>
                </div>
            `;
        }
    }).join('');

    return `
        <div class="stats-grid" style="grid-template-columns: 1fr;">
            <div class="stat-card gold" style="text-align: center;">
                <div class="stat-label">Total Confirmados Hoje</div>
                <div class="stat-value gold" style="justify-content: center;">${allConfirmed}</div>
            </div>
        </div>

        <div class="agenda-nav">
            <button class="agenda-nav-btn" onclick="adminChangeDate(-1)"><i data-lucide="chevron-left"></i></button>
            <div class="agenda-date-display">
                <span class="agenda-day-num">${dayNum}</span>
                <div class="agenda-day-info">
                    <span class="agenda-day-name">${dayOfWeek}</span>
                    <span class="agenda-month">${monthLabel} ${selDate.split('-')[0]}</span>
                </div>
                ${isToday ? '<span class="agenda-today-badge">Hoje</span>' : ''}
            </div>
            <button class="agenda-nav-btn" onclick="adminChangeDate(1)"><i data-lucide="chevron-right"></i></button>
        </div>
        ${!isToday ? `<button class="btn-today" onclick="adminGoToday()"><i data-lucide="calendar" style="width:14px;height:14px;"></i> Ir para Hoje</button>` : ''}

        <div class="agenda-grid">
            ${slotsHtml}
        </div>
        <div style="margin-top: 32px; padding-bottom: 16px;">
            <button class="btn-danger" style="width: 100%; padding: 14px; background: rgba(255, 60, 60, 0.1); border: 1px solid rgba(255, 60, 60, 0.3); color: #ff4d4d; border-radius: var(--radius-md); cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px; font-family: inherit; font-size: 0.9rem; font-weight: 600; transition: all var(--transition-fast);" onclick="adminResetAll()">
                <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i> Resetar Agenda Inteira
            </button>
        </div>
    `;
}

function renderAdminWeekly() {
    const selDate = state.adminSelectedDate;
    const d = new Date(selDate + 'T12:00:00');
    const day = d.getDay(); 
    // Monday is 1, Sunday is 0. Shift so Monday is index 0.
    const diff = (day === 0 ? -6 : 1) - day;
    const startOfWeek = new Date(d);
    startOfWeek.setDate(d.getDate() + diff);
    startOfWeek.setHours(0,0,0,0);

    let daysHtml = '';
    for(let i=0; i<7; i++) {
        const curDate = new Date(startOfWeek);
        curDate.setDate(curDate.getDate() + i);
        const dateStr = curDate.toISOString().split('T')[0];
        const dayApts = state.appointments.filter(a => a.date === dateStr && a.status !== 'rejected');
        
        // Build booked times with duration awareness
        const bookedTimesSet = new Set();
        dayApts.forEach(apt => {
            const svc = BRAND_CONFIG.services.find(s => s.name === apt.service);
            const duration = svc ? svc.duration : 90;
            const slotsNeeded = Math.ceil(duration / 30);
            const startIdx = BRAND_CONFIG.times.indexOf(apt.time);
            if (startIdx === -1) return;
            for (let i = 0; i < slotsNeeded && (startIdx + i) < BRAND_CONFIG.times.length; i++) {
                bookedTimesSet.add(BRAND_CONFIG.times[startIdx + i]);
            }
        });

        let colsHtml = BRAND_CONFIG.times.map(t => {
            const apt = dayApts.find(a => a.time === t);
            const isDurationBlocked = bookedTimesSet.has(t) && !apt;
            const isBlocked = state.blockedSlots.some(b => b.date === dateStr && b.time === t);

            if(apt) return `<div class="w-slot w-booked" onclick="adminChangeDateByStr('${dateStr}'); setAdminView('daily');" title="${apt.client}">${apt.client.split(' ')[0]}</div>`;
            if(isDurationBlocked) return `<div class="w-slot w-booked" onclick="adminChangeDateByStr('${dateStr}'); setAdminView('daily');" title="Ocupado (duração)" style="opacity:0.6;">↕</div>`;
            if(isBlocked) return `<div class="w-slot w-blocked" onclick="toggleBlockSlot('${dateStr}', '${t}')" title="Bloqueado"><i data-lucide="lock" style="width:14px;height:14px;"></i></div>`;
            return `<div class="w-slot w-free" onclick="toggleBlockSlot('${dateStr}', '${t}')" title="Livre (Clique para bloquear)"></div>`;
        }).join('');

        daysHtml += `
            <div class="w-day-col">
                <div class="w-day-header ${dateStr === state.adminSelectedDate ? 'active' : ''}" onclick="adminChangeDateByStr('${dateStr}'); setAdminView('daily');">
                    <span>${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][curDate.getDay()]}</span>
                    <strong style="font-size: 0.9rem;">${curDate.getDate()}</strong>
                </div>
                ${colsHtml}
            </div>
        `;
    }

    const timesHtml = `<div class="w-time-col"><div class="w-day-header" style="opacity:0"><span>T</span><strong>0</strong></div>` + BRAND_CONFIG.times.map(t => `<div class="w-time-label">${t}</div>`).join('') + `</div>`;

    return `
        <div class="agenda-nav" style="margin-bottom:8px;">
           <button class="agenda-nav-btn" onclick="adminChangeDate(-7)"><i data-lucide="chevron-left" style="width:16px;height:16px;"></i></button>
           <div class="agenda-date-display" style="gap:8px;"><span class="agenda-month" style="font-size:0.85rem;font-weight:600;">Semana de ${startOfWeek.getDate()}/${startOfWeek.getMonth()+1}</span></div>
           <button class="agenda-nav-btn" onclick="adminChangeDate(7)"><i data-lucide="chevron-right" style="width:16px;height:16px;"></i></button>
        </div>
        
        <div class="weekly-grid-container">
            ${timesHtml}
            ${daysHtml}
        </div>
        <p style="text-align:center;font-size:0.75rem;color:var(--text-muted);margin-top:12px;">Clique num dia para ver a agenda diária ou num horário vazio para bloquear.</p>
    `;
}

function renderAdminMonthly() {
    const selDate = state.adminSelectedDate;
    const d = new Date(selDate + 'T12:00:00');
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();

    let daysHtml = '';
    for(let i=0; i<startPadding; i++) {
        daysHtml += `<div class="m-day empty"></div>`;
    }
    for(let i=1; i<=lastDay.getDate(); i++) {
        const curDate = new Date(year, month, i);
        const dateStr = curDate.toISOString().split('T')[0];
        const dayApts = state.appointments.filter(a => a.date === dateStr && a.status !== 'rejected');
        const count = dayApts.length;

        daysHtml += `
            <div class="m-day ${dateStr === state.adminSelectedDate ? 'active' : ''}" onclick="adminChangeDateByStr('${dateStr}'); setAdminView('daily');">
                <span class="m-num">${i}</span>
                ${count > 0 ? `<span class="m-dot">${count}</span>` : ''}
            </div>
        `;
    }

    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    return `
        <div class="agenda-nav" style="margin-bottom:16px;">
           <button class="agenda-nav-btn" onclick="adminChangeMonth(-1)"><i data-lucide="chevron-left"></i></button>
           <div class="agenda-date-display"><span class="agenda-month">${monthNames[month]} ${year}</span></div>
           <button class="agenda-nav-btn" onclick="adminChangeMonth(1)"><i data-lucide="chevron-right"></i></button>
        </div>

        <div class="monthly-grid">
            ${['D','S','T','Q','Q','S','S'].map(d => `<div class="m-head">${d}</div>`).join('')}
            ${daysHtml}
        </div>
        <p style="text-align:center;font-size:0.75rem;color:var(--text-muted);margin-top:12px;">Selecione um dia para ver ou gerenciar a agenda detalhada.</p>
    `;
}

// ═══════════════════════════════════════════════
//  ACTIONS
// ═══════════════════════════════════════════════

// Phone mask
window.handlePhoneInput = (input) => {
    const cursorPos = input.selectionStart;
    const prevLen = input.value.length;
    input.value = phoneMask(input.value);
    state.booking.clientPhone = input.value;
    // Adjust cursor position
    const diff = input.value.length - prevLen;
    input.setSelectionRange(cursorPos + diff, cursorPos + diff);
};

window.toggleFinishCard = (checked) => {
    state.booking.termsAccepted = checked;
    const btn = document.getElementById('btn-finish');
    if(btn) btn.disabled = !checked;
};

// Service flow
window.selectQuickService = (id) => {
    state.booking.service = BRAND_CONFIG.services.find(s => s.id === id);
    if (hasSingleBarber()) {
        state.booking.barber = BRAND_CONFIG.barbers[0];
        navigate('calendar');
    } else {
        navigate('barbers');
    }
};

window.selectService = (id) => {
    state.booking.service = BRAND_CONFIG.services.find(s => s.id === id);
    render();
};

window.goAfterService = () => {
    if (hasSingleBarber()) {
        state.booking.barber = BRAND_CONFIG.barbers[0];
        navigate('calendar');
    } else {
        navigate('barbers');
    }
};

window.selectBarber = (id) => {
    state.booking.barber = BRAND_CONFIG.barbers.find(b => b.id === id);
    render();
};

window.updateDate = (date) => {
    state.booking.date = date;
    state.booking.time = null; // Reset time when date changes
    render();
};

window.selectTime = (time) => {
    state.booking.time = time;
    render();
};

// Booking
window.finishBooking = async () => {
    if (!state.booking.clientName.trim()) {
        showToast('Informe seu nome.', 'error');
        document.getElementById('client-name')?.focus();
        return;
    }
    const phoneDigits = state.booking.clientPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
        showToast('Informe um WhatsApp válido.', 'error');
        document.getElementById('client-phone')?.focus();
        return;
    }

    // Save client data for next time
    saveClient(state.booking.clientName, state.booking.clientPhone);

    state.isBookingInProgress = true;
    const btn = document.getElementById('btn-finish');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="spinner-small"></i> Finalizando...';
    }

    const newApt = {
        client: state.booking.clientName,
        phone: state.booking.clientPhone,
        service: state.booking.service.name,
        price: state.booking.service.price.toFixed(2),
        barber: state.booking.barber.name,
        time: state.booking.time,
        date: state.booking.date,
        status: "confirmed", // Auto-confirm!
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("TIMEOUT")), 10000); // 10s de limite
        });

        // Espera no máximo 10s. Se o Firebase estiver off ou desativado, desiste.
        const docRef = await Promise.race([
            tenantCol('appointments').add(newApt),
            timeoutPromise
        ]);
        state.lastAddedAptId = docRef.id;
    } catch (e) {
        console.error("Erro ao salvar agendamento:", e);
        if (e.message === "TIMEOUT") {
            showToast('Falha na comunicação com o banco de dados. Tente novamente mais tarde.', 'error');
        } else {
            showToast('Erro ao salvar agendamento. Tente novamente.', 'error');
        }
        state.isBookingInProgress = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="check-circle"></i> Finalizar Agendamento';
            if (window.lucide) lucide.createIcons();
        }
        return;
    }

    try {
        const fetchPhone = '55' + phoneDigits; // Assumindo Brasil (55)
        const fetchMsg = `Olá ${newApt.client}!\n\nSeu agendamento para *${newApt.service}* com ${newApt.barber} foi recebido!\n\n📅 Data: ${newApt.date.split('-').reverse().join('/')}\n🕐 Horário: ${newApt.time}\n💰 Valor: R$ ${newApt.price}\n\nLembre-se:\n- Chegue 10 minutos antes.\n- Se precisar cancelar, avise com antecedência.\n- Faltas sem aviso prévio geram multa de 10% no próximo serviço.\n\nAté logo! - ${BRAND_CONFIG.name}`;

        fetch('http://localhost:3000/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: fetchPhone, message: fetchMsg })
        }).catch(err => console.log('Bot WhatsApp offline:', err));
    } catch(e) {}

    state.isBookingInProgress = false;
    navigate('success');
};

window.resetApp = () => {
    state.booking = {
        service: null,
        barber: null,
        date: new Date().toISOString().split('T')[0],
        time: null,
        clientName: state.booking.clientName, // Keep saved data
        clientPhone: state.booking.clientPhone,
        termsAccepted: false
    };
    state.lastAddedAptId = null;
    navigate('home');
};

// Admin
window.handleLogin = () => {
    const email = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    if (!email || !password) { showToast('Preencha e-mail e senha.', 'error'); return; }
    if (email === BRAND_CONFIG.admin.email && password === BRAND_CONFIG.admin.password) {
        state.isAdminLoggedIn = true;
        localStorage.setItem('barberapp_admin', 'true');
        setupNav();
        showToast('Bem-vindo!', 'success');
        navigate('admin');
    } else {
        showToast('E-mail ou senha incorretos.', 'error');
    }
};

window.handleLogout = () => {
    state.isAdminLoggedIn = false;
    localStorage.removeItem('barberapp_admin');
    setupNav();
    showToast('Você saiu do painel.', 'info');
    navigate('home');
};

window.adminChangeDate = (delta) => {
    const d = new Date(state.adminSelectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    state.adminSelectedDate = d.toISOString().split('T')[0];
    render();
};

window.adminGoToday = () => {
    state.adminSelectedDate = new Date().toISOString().split('T')[0];
    render();
};

window.togglePassword = () => {
    const input = document.getElementById('login-password');
    const icon = document.getElementById('eye-icon');
    if (input.type === 'password') { input.type = 'text'; icon.setAttribute('data-lucide', 'eye-off'); }
    else { input.type = 'password'; icon.setAttribute('data-lucide', 'eye'); }
    lucide.createIcons();
};

window.updateAppointmentStatus = async (id, status) => {
    try {
        const apt = state.appointments.find(a => a.id === id);
        if (apt) {
            await tenantCol('appointments').doc(id).update({ status });
            showToast(
                status === 'confirmed' ? `${apt.client} confirmado!` : `${apt.client} cancelado.`,
                status === 'confirmed' ? 'success' : 'info'
            );
        }
    } catch (e) {
        console.error("Erro ao atualizar status", e);
        showToast('Erro de conexão.', 'error');
    }
};

window.copyPix = (key) => {
    const finalKey = typeof key === 'string' ? key : document.getElementById('pix-key')?.innerText;
    if (finalKey) {
        navigator.clipboard.writeText(finalKey).then(() => {
            showToast('Chave Pix copiada!', 'success');
        }).catch(() => showToast('Chave: ' + finalKey, 'info'));
    }
};

window.adminResetAll = async () => {
    if (!confirm("🚨 TEM CERTEZA? 🚨\nIsso vai apagar TODOS os agendamentos e horários bloqueados de todos os dias. Essa ação NÃO PODE ser defeita.")) return;
    try {
        const apts = await tenantCol('appointments').get();
        const batch = db.batch();
        apts.docs.forEach(doc => batch.delete(doc.ref));
        
        const blocks = await tenantCol('blockedSlots').get();
        blocks.docs.forEach(doc => batch.delete(doc.ref));
        
        await batch.commit();
        showToast('Agenda totalmente zerada!', 'success');
    } catch(e) {
        console.error("Erro ao resetar", e);
        showToast('Erro ao apagar agenda.', 'error');
    }
};

// ── Services CRUD ──────────────────────────────

window.updateIconPreview = (id, iconName) => {
    const preview = document.getElementById(`icon-preview-${id}`);
    if (preview) {
        preview.innerHTML = `<i data-lucide="${iconName}" style="width:18px;height:18px;"></i>`;
        lucide.createIcons();
    }
};

window.updateService = (id) => {
    const svc = BRAND_CONFIG.services.find(s => s.id === id);
    if (!svc) return;
    const nameEl = document.getElementById(`svc-name-${id}`);
    const priceEl = document.getElementById(`svc-price-${id}`);
    const durEl = document.getElementById(`svc-dur-${id}`);
    const iconEl = document.querySelector(`#svc-row-${id} .admin-svc-icon-select`);

    const newName = nameEl?.value?.trim();
    const newPrice = parseFloat(priceEl?.value);
    const newDur = parseInt(durEl?.value);
    const newIcon = iconEl?.value || 'scissors';

    if (!newName) { showToast('Nome não pode ser vazio.', 'error'); return; }
    if (isNaN(newPrice) || newPrice < 0) { showToast('Preço inválido.', 'error'); return; }
    if (isNaN(newDur) || newDur < 5) { showToast('Duração mínima: 5 min.', 'error'); return; }

    Object.assign(svc, { name: newName, price: newPrice, duration: newDur, icon: newIcon });
    tenantCol('services').doc(String(id)).set({ ...svc }).then(() => {
        showToast(`"${newName}" salvo!`, 'success');
        render();
    }).catch(() => showToast('Erro ao salvar.', 'error'));
};

window.updateServicePrice = (id, value) => {
    const svc = BRAND_CONFIG.services.find(s => s.id === id);
    if (!svc) return;
    const newPrice = parseFloat(value);
    if (isNaN(newPrice) || newPrice < 0) { showToast('Preço inválido.', 'error'); return; }
    svc.price = newPrice;
    tenantCol('services').doc(String(id)).set({ ...svc }).then(() => {
        showToast(`${svc.name}: preço atualizado!`, 'success');
    }).catch(() => showToast('Erro ao salvar preço.', 'error'));
};

window.addService = () => {
    const name = document.getElementById('new-svc-name')?.value?.trim();
    const price = parseFloat(document.getElementById('new-svc-price')?.value);
    const duration = parseInt(document.getElementById('new-svc-duration')?.value);
    const icon = document.getElementById('new-svc-icon')?.value || 'scissors';

    if (!name) { showToast('Informe o nome do serviço.', 'error'); return; }
    if (isNaN(price) || price < 0) { showToast('Informe um preço válido.', 'error'); return; }
    if (isNaN(duration) || duration < 5) { showToast('Informe a duração (mínimo 5 min).', 'error'); return; }

    const newId = Date.now();
    const newSvc = { id: newId, name, price, duration, icon };
    BRAND_CONFIG.services.push(newSvc);

    tenantCol('services').doc(String(newId)).set(newSvc).then(() => {
        showToast(`Serviço "${name}" adicionado!`, 'success');
        render();
    }).catch(() => showToast('Erro ao salvar serviço.', 'error'));
};

window.removeService = async (id) => {
    const svc = BRAND_CONFIG.services.find(s => s.id === id);
    if (!svc) return;
    if (!confirm(`Remover o serviço "${svc.name}"?`)) return;

    BRAND_CONFIG.services = BRAND_CONFIG.services.filter(s => s.id !== id);
    try {
        await tenantCol('services').doc(String(id)).delete();
        showToast(`"${svc.name}" removido.`, 'info');
    } catch(e) {
        showToast('Erro ao remover serviço.', 'error');
    }
    render();
};

async function initTenant() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('id');
    if (urlId) {
        state.tenantId = urlId.toLowerCase().trim();
    } // otherwise keeps 'tatinha' as defined in state

    try {
        const docRef = db.collection('tenants').doc(state.tenantId);
        const docSnap = await docRef.get();
        
        if (docSnap.exists) {
            const data = docSnap.data();
            Object.assign(BRAND_CONFIG, data);
            
            // Injetar CSS dinâmico se a cor principal existir
            if (data.colors && data.colors.primary) {
                document.documentElement.style.setProperty('--primary', data.colors.primary);
            }
        } else {
            // Seeder: se a URL for nova, criamos o tenant base usando o BRAND_CONFIG padrao
            await docRef.set({
                name: BRAND_CONFIG.name,
                barberWhatsApp: BRAND_CONFIG.barberWhatsApp,
                colors: BRAND_CONFIG.colors,
                bannerSlides: BRAND_CONFIG.bannerSlides,
                admin: BRAND_CONFIG.admin
            });
        }
        
        // Atualiza os metadados da página
        document.title = BRAND_CONFIG.name;
        
        // Load services isolated by tenant
        const servicesSnap = await tenantCol('services').get();
        if (!servicesSnap.empty) {
            BRAND_CONFIG.services = servicesSnap.docs.map(d => d.data());
        } else {
            // Seeder services for new tenants
            const batch = db.batch();
            BRAND_CONFIG.services.forEach(s => {
                batch.set(tenantCol('services').doc(String(s.id)), s);
            });
            await batch.commit();
        }
    } catch(e) {
        console.error("Erro ao carregar configurações do lojista (tenant):", e);
    }
}
// ═══════════════════════════════════════════════
//  PWA INSTALLATION LOGIC
// ═══════════════════════════════════════════════
let deferredPrompt;
const installBtn = document.getElementById('pwa-install-btn');
const iosModal = document.getElementById('ios-guide-modal');
const androidModal = document.getElementById('android-guide-modal');

// Detect if app is already running in standalone mode
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

// Show button by default if not installed (so user can see it during testing)
if (installBtn && !isStandalone) {
    installBtn.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent standard browser bar from showing
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
});

// Handle iOS specific detection
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (isIOS) {
            // Show iOS instructions modal
            iosModal.classList.add('active');
        } else if (deferredPrompt) {
            // Show Android educational modal before the native prompt
            if (androidModal) {
                androidModal.classList.add('active');
            } else {
                deferredPrompt.prompt();
            }
        } else {
            // Fallback for browsers that don't support beforeinstallprompt
            alert('Para instalar, use a opção "Adicionar à tela de início" (Chrome) ou "Instalar Aplicativo" no menu do seu navegador.');
        }
    });
}

window.proceedAndroidInstall = async () => {
    if (androidModal) androidModal.classList.remove('active');
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.style.display = 'none';
        }
        deferredPrompt = null;
    }
};

window.closeAndroidModal = () => {
    if (androidModal) androidModal.classList.remove('active');
};

window.closeIosModal = () => {
    iosModal.classList.remove('active');
};

window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
    deferredPrompt = null;
});

// ── Start ──────────────────────────────────────
initTenant().then(() => init());
