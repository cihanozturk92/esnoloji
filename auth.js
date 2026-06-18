const AUTH_KEY = 'girisYapanPersonel';

function oturumAl() {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function bildirimGoster(mesaj, tip = 'bilgi') {
    let alan = document.getElementById('bildirimAlani');
    if (!alan) {
        alan = document.createElement('div');
        alan.id = 'bildirimAlani';
        alan.style.position = 'fixed';
        alan.style.left = '50%';
        alan.style.bottom = '16px';
        alan.style.transform = 'translateX(-50%)';
        alan.style.zIndex = '9999';
        alan.style.width = 'min(92vw, 360px)';
        alan.style.display = 'flex';
        alan.style.flexDirection = 'column';
        alan.style.gap = '8px';
        alan.style.pointerEvents = 'none';
        document.body.appendChild(alan);
    }

    const renkler = {
        basari: { border: '#a7f3d0', bg: '#ecfdf5', text: '#065f46' },
        hata: { border: '#fecaca', bg: '#fef2f2', text: '#991b1b' },
        uyari: { border: '#fde68a', bg: '#fffbeb', text: '#92400e' },
        bilgi: { border: '#cbd5e1', bg: '#ffffff', text: '#0f172a' }
    };
    const ikonlar = { basari: 'OK', hata: '!', uyari: '!', bilgi: 'i' };
    const tema = renkler[tip] || renkler.bilgi;

    const kutu = document.createElement('div');
    kutu.setAttribute('role', 'status');
    kutu.style.display = 'flex';
    kutu.style.alignItems = 'flex-start';
    kutu.style.gap = '12px';
    kutu.style.padding = '14px 16px';
    kutu.style.borderRadius = '16px';
    kutu.style.border = `1px solid ${tema.border}`;
    kutu.style.background = tema.bg;
    kutu.style.color = tema.text;
    kutu.style.boxShadow = '0 16px 36px rgba(15, 23, 42, 0.16)';
    kutu.style.opacity = '0';
    kutu.style.transform = 'translateY(14px)';
    kutu.style.transition = 'opacity 220ms ease, transform 220ms ease';
    kutu.style.pointerEvents = 'auto';
    kutu.innerHTML = `
        <div style="display:flex;height:28px;width:28px;flex:0 0 28px;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,255,255,.78);font-size:11px;font-weight:800;">${ikonlar[tip] || ikonlar.bilgi}</div>
        <div style="min-width:0;flex:1;font-size:14px;font-weight:600;line-height:1.45;">${mesaj}</div>
        <button type="button" aria-label="Kapat" style="border:0;background:transparent;padding:0;margin:0;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.55;">&times;</button>
    `;

    const kapatButonu = kutu.querySelector('button');
    kapatButonu.onmouseenter = () => { kapatButonu.style.opacity = '1'; };
    kapatButonu.onmouseleave = () => { kapatButonu.style.opacity = '.55'; };
    kapatButonu.onclick = () => kutu.remove();
    alan.appendChild(kutu);
    requestAnimationFrame(() => {
        kutu.style.opacity = '1';
        kutu.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
        kutu.style.opacity = '0';
        kutu.style.transform = 'translateY(14px)';
        setTimeout(() => kutu.remove(), 220);
    }, 3600);
}
function onayIste(mesaj, baslik = 'Onay gerekiyor') {
    return new Promise((resolve) => {
        const eski = document.getElementById('onayPenceresi');
        if (eski) eski.remove();

        const perde = document.createElement('div');
        perde.id = 'onayPenceresi';
        perde.style.position = 'fixed';
        perde.style.inset = '0';
        perde.style.zIndex = '9998';
        perde.style.display = 'flex';
        perde.style.alignItems = 'center';
        perde.style.justifyContent = 'center';
        perde.style.padding = '16px';
        perde.style.background = 'rgba(15, 23, 42, 0.62)';
        perde.style.backdropFilter = 'blur(6px)';
        perde.innerHTML = `
            <div style="width:min(100%, 380px);border-radius:18px;background:#ffffff;padding:20px;box-shadow:0 24px 50px rgba(15,23,42,.28);">
                <div style="font-size:16px;font-weight:800;color:#0f172a;">${baslik}</div>
                <p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#475569;">${mesaj}</p>
                <div style="margin-top:18px;display:flex;gap:8px;">
                    <button type="button" data-cevap="hayir" style="flex:1;border:0;border-radius:12px;background:#e2e8f0;padding:12px 14px;font-size:14px;font-weight:800;color:#475569;cursor:pointer;">Vazgec</button>
                    <button type="button" data-cevap="evet" style="flex:1;border:0;border-radius:12px;background:#0f172a;padding:12px 14px;font-size:14px;font-weight:800;color:#ffffff;cursor:pointer;">Onayla</button>
                </div>
            </div>
        `;

        perde.addEventListener('click', (event) => {
            const cevap = event.target?.dataset?.cevap;
            if (!cevap) return;
            perde.remove();
            resolve(cevap === 'evet');
        });

        document.body.appendChild(perde);
    });
}
function oturumKaydet(personel) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(personel));
}

async function oturumSunucudanAl() {
    try {
        const res = await fetch('/api/session');
        if (!res.ok) return null;

        const data = await res.json();
        const personel = data.personel || null;
        if (personel) oturumKaydet(personel);
        return personel;
    } catch {
        return null;
    }
}

async function oturumHazirla() {
    return oturumAl() || await oturumSunucudanAl();
}

function cikisYap() {
    localStorage.removeItem(AUTH_KEY);
    fetch('/api/logout', { method: 'POST', keepalive: true }).finally(() => {
        window.location.href = '/';
    });
}

function panelAdresi(personel) {
    if (!personel) return '/';
    const rol = String(personel.rol || '').trim().toLowerCase();
    const slug = personel.dukkanSlug;
    switch (rol) {
        case 'superadmin':
        case 'superadmin':
            return '/super-admin';
        case 'admin':
            return slug ? `/${slug}/admin` : '/';
        case 'garson':
            return slug ? `/${slug}/garson` : '/';
        default:
            return '/';
    }
}

function personelAdi(personel) {
    return personel?.ad || personel?.kullanici_id || 'Personel';
}

function rolEtiketi(personel) {
    const rol = String(personel?.rol || '').trim().toLowerCase();
    if (rol === 'admin') return 'Admin';
    if (rol === 'garson') return 'Garson';
    if (rol === 'superadmin') return 'Super Admin';
    return personel?.rol || 'Personel';
}




