const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const QRCode = require('qrcode');

function envDosyasiniYukle() {
    const envYolu = path.join(__dirname, '.env');
    if (!fs.existsSync(envYolu)) return;

    const satirlar = fs.readFileSync(envYolu, 'utf8').split(/\r?\n/);
    for (const satir of satirlar) {
        const temizSatir = satir.trim();
        if (!temizSatir || temizSatir.startsWith('#')) continue;

        const esittirIndex = temizSatir.indexOf('=');
        if (esittirIndex === -1) continue;

        const anahtar = temizSatir.slice(0, esittirIndex).trim();
        let deger = temizSatir.slice(esittirIndex + 1).trim();
        if ((deger.startsWith('"') && deger.endsWith('"')) || (deger.startsWith("'") && deger.endsWith("'"))) {
            deger = deger.slice(1, -1);
        }

        if (anahtar && process.env[anahtar] === undefined) {
            process.env[anahtar] = deger;
        }
    }
}

function gerekliEnv(anahtar) {
    const deger = process.env[anahtar];
    if (!deger) {
        throw new Error(`${anahtar} env degiskeni eksik. .env dosyasini veya hosting env ayarlarini kontrol edin.`);
    }
    return deger;
}

envDosyasiniYukle();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('trust proxy', 1);
app.use(express.json());

// Supabase BaÄŸlantÄ±sÄ±
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = gerekliEnv('SUPABASE_URL');
const SUPABASE_KEY = gerekliEnv('SUPABASE_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_COOKIE = 'esnoloji_session';
const SESSION_SECRET = gerekliEnv('SESSION_SECRET');
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

function rolTemizle(rol) {
    return String(rol || '').trim().toLocaleLowerCase('tr-TR');
}

function restoranTuruMu(tur) {
    const temizTur = String(tur || '').toLocaleLowerCase('tr-TR');
    return temizTur.includes('restoran') || temizTur.includes('cafe') || temizTur.includes('kafe');
}

function siteBaseUrl(req) {
    const envUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
    if (envUrl) return envUrl.replace(/\/+$/, '');

    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol;
    return `${protocol}://${req.get('host')}`;
}

function dosyaAdiTemizle(value) {
    return String(value || 'dukkan')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'dukkan';
}

function opsiyonelMetin(value) {
    const temiz = String(value || '').trim();
    return temiz || null;
}

function ayAraligiHazirla(ayDegeri) {
    const eslesme = String(ayDegeri || '').match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    const yil = eslesme ? Number(eslesme[1]) : now.getFullYear();
    const ay = eslesme ? Number(eslesme[2]) - 1 : now.getMonth();
    const baslangic = new Date(yil, ay, 1);
    const bitis = new Date(yil, ay + 1, 1);
    return { baslangic, bitis, ay: `${yil}-${String(ay + 1).padStart(2, '0')}` };
}

const YEREL_GORSEL_UZANTILARI = ['.webp', '.png', '.jpg', '.jpeg'];

function yerelDukkanGorselUrl(slug, tip) {
    const temizSlug = String(slug || '')
        .trim()
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/^-+|-+$/g, '');

    if (!temizSlug || !['logo', 'arkaplan'].includes(tip)) return null;

    const klasor = path.join(__dirname, 'resimler');
    if (!fs.existsSync(klasor)) return null;

    const beklenenBaslangic = (temizSlug + '_' + tip).toLocaleLowerCase('tr-TR');
    const dosya = fs.readdirSync(klasor).find((ad) => {
        const parsed = path.parse(ad);
        return parsed.name.toLocaleLowerCase('tr-TR') === beklenenBaslangic &&
            YEREL_GORSEL_UZANTILARI.includes(parsed.ext.toLocaleLowerCase('tr-TR'));
    });

    if (!dosya) return null;

    const tamYol = path.join(klasor, dosya);
    const surum = Math.floor(fs.statSync(tamYol).mtimeMs);
    return '/resimler/' + encodeURIComponent(dosya) + '?v=' + surum;
}

function dukkanGorselleriniNormalle(dukkan) {
    if (!dukkan || typeof dukkan !== 'object') return dukkan;

    return {
        ...dukkan,
        logo_url: yerelDukkanGorselUrl(dukkan.slug, 'logo'),
        arka_plan_url: yerelDukkanGorselUrl(dukkan.slug, 'arkaplan')
    };
}

function tanitimKolonuEksikMi(error) {
    const mesaj = String(error?.message || '').toLocaleLowerCase('tr-TR');
    return error?.code === 'PGRST204' || mesaj.includes('telefon') || mesaj.includes('adres') || mesaj.includes('aciklama');
}

function gorselKolonuEksikMi(error) {
    const mesaj = String(error?.message || '').toLocaleLowerCase('tr-TR');
    return error?.code === 'PGRST204' || mesaj.includes('logo_url') || mesaj.includes('arka_plan_url') || mesaj.includes('arkaplan_url');
}

function siparisDetayKolonuEksikMi(error) {
    const mesaj = String(error?.message || '').toLocaleLowerCase('tr-TR');
    return error?.code === 'PGRST204' || mesaj.includes('personel_id') || mesaj.includes('personel_adi');
}

function rezervasyonPersonelKolonuEksikMi(error) {
    const mesaj = String(error?.message || '').toLocaleLowerCase('tr-TR');
    return error?.code === 'PGRST204' || mesaj.includes('personel_id') || mesaj.includes('personel_adi');
}

function giderOgeKolonuEksikMi(error) {
    const mesaj = String(error?.message || '').toLocaleLowerCase('tr-TR');
    return error?.code === 'PGRST204' || mesaj.includes('oge_id') || mesaj.includes('oge_adi');
}

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_SCRYPT_N = 16384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_KEYLEN = 64;

function guvenliMetinKarsilastir(a, b) {
    const aBuffer = Buffer.from(String(a || ''));
    const bBuffer = Buffer.from(String(b || ''));
    if (aBuffer.length !== bBuffer.length) return false;
    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function sifreHashMi(sifre) {
    return String(sifre || '').startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

function sifreHashle(sifre) {
    const salt = crypto.randomBytes(16).toString('base64url');
    const hash = crypto.scryptSync(String(sifre), salt, PASSWORD_KEYLEN, {
        N: PASSWORD_SCRYPT_N,
        r: PASSWORD_SCRYPT_R,
        p: PASSWORD_SCRYPT_P,
        maxmem: 64 * 1024 * 1024
    }).toString('base64url');
    return `${PASSWORD_HASH_PREFIX}$${PASSWORD_SCRYPT_N}$${PASSWORD_SCRYPT_R}$${PASSWORD_SCRYPT_P}$${salt}$${hash}`;
}

function sifreDogrula(girilenSifre, kayitliSifre) {
    const kayit = String(kayitliSifre || '');
    if (!sifreHashMi(kayit)) return guvenliMetinKarsilastir(girilenSifre, kayit);

    try {
        const [prefix, n, r, p, salt, hash] = kayit.split('$');
        if (prefix !== PASSWORD_HASH_PREFIX || !n || !r || !p || !salt || !hash) return false;

        const hesaplanan = crypto.scryptSync(String(girilenSifre), salt, Buffer.from(hash, 'base64url').length, {
            N: Number(n),
            r: Number(r),
            p: Number(p),
            maxmem: 64 * 1024 * 1024
        }).toString('base64url');

        return guvenliMetinKarsilastir(hesaplanan, hash);
    } catch {
        return false;
    }
}

function sifrePolitikasiHatasi(sifre, kullaniciId = '') {
    const deger = String(sifre || '');
    const kullanici = String(kullaniciId || '').toLocaleLowerCase('tr-TR').trim();
    const kucuk = deger.toLocaleLowerCase('tr-TR');
    const yaygin = ['123456', '12345678', '123456789', 'password', 'qwerty', '111111', '000000', 'admin', 'sifre'];

    if (deger.length < 8) return 'Sifre en az 8 karakter olmali.';
    if (deger.length > 128) return 'Sifre 128 karakterden uzun olamaz.';
    if (!/[a-z]/.test(deger) || !/[A-Z]/.test(deger)) return 'Sifre buyuk ve kucuk harf icermeli.';
    if (!/\d/.test(deger)) return 'Sifre en az bir rakam icermeli.';
    if (/^(.)\1+$/.test(deger)) return 'Sifre tek karakter tekrarindan olusamaz.';
    if (yaygin.some(s => kucuk.includes(s))) return 'Bu sifre cok yaygin, daha guclu bir sifre secin.';
    if (kullanici && kullanici.length >= 3 && kucuk.includes(kullanici)) return 'Sifre kullanici adini icermemeli.';
    return null;
}

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function imzaOlustur(payload) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function cookieOku(req, ad) {
    const raw = req.headers.cookie || '';
    const cookies = raw.split(';').map(x => x.trim()).filter(Boolean);
    for (const cookie of cookies) {
        const index = cookie.indexOf('=');
        if (index === -1) continue;
        if (cookie.slice(0, index) === ad) return decodeURIComponent(cookie.slice(index + 1));
    }
    return null;
}

function sessionTokenOlustur(personel) {
    const payload = base64url(JSON.stringify({
        id: personel.id,
        kullanici_id: personel.kullanici_id,
        rol: personel.rol,
        dukkan_id: personel.dukkan_id || null,
        dukkan_slug: personel.dukkan_slug || null,
        iat: Date.now(),
        exp: Date.now() + SESSION_MAX_AGE
    }));
    return `${payload}.${imzaOlustur(payload)}`;
}

function sessionDogrula(req) {
    const token = cookieOku(req, SESSION_COOKIE);
    if (!token || !token.includes('.')) return null;

    const [payload, imza] = token.split('.');
    const beklenen = imzaOlustur(payload);
    if (Buffer.byteLength(imza) !== Buffer.byteLength(beklenen)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(imza), Buffer.from(beklenen))) return null;

    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!session.exp || session.exp < Date.now()) return null;
        return session;
    } catch {
        return null;
    }
}

function sessionCookieYaz(res, personel) {
    const token = sessionTokenOlustur(personel);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function sessionCookieSil(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

function yetkiGerekli(roller, ayarlar = {}) {
    const izinliRoller = roller.map(rolTemizle);
    return (req, res, next) => {
        const session = sessionDogrula(req);
        if (!session) return res.redirect('/');

        const rol = rolTemizle(session.rol);
        if (!izinliRoller.includes(rol)) return res.redirect('/');

        if (ayarlar.dukkanSlugEslesmeli && rol !== 'superadmin' && rol !== 'sÃ¼peradmin') {
            const istenenSlug = req.params.dukkan_adi || req.params.slug;
            if (istenenSlug && session.dukkan_slug !== istenenSlug) return res.redirect('/');
        }

        req.session = session;
        next();
    };
}

function apiYetkiGerekli(roller, ayarlar = {}) {
    const izinliRoller = roller.map(rolTemizle);
    return (req, res, next) => {
        const session = sessionDogrula(req);
        if (!session) return res.status(401).json({ error: 'Oturum gerekli.' });

        const rol = rolTemizle(session.rol);
        if (!izinliRoller.includes(rol)) return res.status(403).json({ error: 'Bu islem icin yetkiniz yok.' });

        if (ayarlar.dukkanSlugEslesmeli && rol !== 'superadmin' && rol !== 'sÃ¼peradmin') {
            const istenenSlug = req.params.dukkan_adi || req.params.slug;
            if (istenenSlug && session.dukkan_slug !== istenenSlug) return res.status(403).json({ error: 'Bu dukkan icin yetkiniz yok.' });
        }

        if (ayarlar.dukkanIdEslesmeli && rol !== 'superadmin' && rol !== 'sÃ¼peradmin') {
            const istenenId = req.params.dukkanId || req.body?.dukkan_id;
            if (istenenId && Number(session.dukkan_id) !== Number(istenenId)) return res.status(403).json({ error: 'Bu dukkan icin yetkiniz yok.' });
        }

        req.session = session;
        next();
    };
}

// --- 1. SUPER ADMIN ROTALARI ---

app.use(express.static(__dirname));

const DUKKAN_KOLONLARI = 'id, slug, ad, tur, telefon, adres, aciklama, logo_url, arka_plan_url';

async function dukkanBilgisiBulBySlug(slug) {
    const { data, error } = await supabase
        .from('dukkanlar')
        .select(DUKKAN_KOLONLARI)
        .eq('slug', slug)
        .maybeSingle();

    if (!error && data) return dukkanGorselleriniNormalle(data);
    if (error && (tanitimKolonuEksikMi(error) || gorselKolonuEksikMi(error))) {
        const { data: sade, error: sadeErr } = await supabase
            .from('dukkanlar')
            .select('id, slug, ad, tur')
            .eq('slug', slug)
            .maybeSingle();

        if (sadeErr) throw sadeErr;
        if (!sade) return null;
        return dukkanGorselleriniNormalle({
            ...sade,
            telefon: null,
            adres: null,
            aciklama: null,
            logo_url: null,
            arka_plan_url: null
        });
    }

    if (error) throw error;
    return null;
}

async function dukkanBilgisiBulById(id) {
    if (!id) return null;

    const { data, error } = await supabase
        .from('dukkanlar')
        .select(DUKKAN_KOLONLARI)
        .eq('id', id)
        .maybeSingle();

    if (!error && data) return dukkanGorselleriniNormalle(data);
    if (error && (tanitimKolonuEksikMi(error) || gorselKolonuEksikMi(error))) {
        const { data: sade, error: sadeErr } = await supabase
            .from('dukkanlar')
            .select('id, slug, ad, tur')
            .eq('id', id)
            .maybeSingle();

        if (sadeErr) throw sadeErr;
        if (!sade) return null;
        return dukkanGorselleriniNormalle({
            ...sade,
            telefon: null,
            adres: null,
            aciklama: null,
            logo_url: null,
            arka_plan_url: null
        });
    }

    if (error) throw error;
    return null;
}

function kullaniciRolunuHazirla(rol) {
    const temiz = rolTemizle(rol);
    if (temiz === 'superadmin' || temiz === 'sÃ¼peradmin') return 'superadmin';
    return temiz;
}

function htmlCacheKapat(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

app.get('/super-admin', yetkiGerekli(['superadmin', 'sÃ¼peradmin']), (req, res) => {
    htmlCacheKapat(res);
    res.sendFile(path.join(__dirname, 'super-admin.html'));
});
app.get('/superadmin/dashboard', yetkiGerekli(['superadmin', 'sÃ¼peradmin']), (req, res) => res.redirect('/super-admin'));

app.post('/api/login', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    try {
        if (!username || !password) {
            return res.status(400).json({ error: 'Kullanici adi ve sifre zorunlu.' });
        }

        const { data: personel, error: personelErr } = await supabase
            .from('personel')
            .select('id, kullanici_id, sifre, rol, dukkan_id')
            .ilike('kullanici_id', username)
            .maybeSingle();

        if (personelErr) throw personelErr;
        if (!personel || !sifreDogrula(password, personel.sifre)) {
            return res.status(401).json({ error: 'Kullanici adi veya sifre hatali.' });
        }

        if (!sifreHashMi(personel.sifre)) {
            await supabase
                .from('personel')
                .update({ sifre: sifreHashle(password) })
                .eq('id', personel.id);
        }

        const rol = kullaniciRolunuHazirla(personel.rol);
        const dukkan = await dukkanBilgisiBulById(personel.dukkan_id);
        const sessionPersonel = {
            id: personel.id,
            kullanici_id: personel.kullanici_id,
            rol,
            dukkan_id: personel.dukkan_id || dukkan?.id || null,
            dukkan_slug: dukkan?.slug || null
        };

        sessionCookieYaz(res, sessionPersonel);

        let redirect = '/';
        if (rol === 'superadmin') redirect = '/super-admin';
        else if (rol === 'admin' && sessionPersonel.dukkan_slug) redirect = `/${sessionPersonel.dukkan_slug}/admin`;
        else if (rol === 'garson' && sessionPersonel.dukkan_slug) redirect = `/${sessionPersonel.dukkan_slug}/garson`;

        res.json({
            status: 'success',
            rol,
            dukkan_slug: sessionPersonel.dukkan_slug,
            dukkan_id: sessionPersonel.dukkan_id,
            redirect
        });
    } catch (err) {
        console.error('Login hatasi:', err);
        res.status(500).json({ error: 'Veritabani sorgusu basarisiz oldu.' });
    }
});

app.get('/api/session', async (req, res) => {
    try {
        const session = sessionDogrula(req);
        if (!session) return res.json({ personel: null });

        res.json({
            personel: {
                id: session.id,
                ad: session.kullanici_id,
                kullanici_id: session.kullanici_id,
                rol: kullaniciRolunuHazirla(session.rol),
                dukkanSlug: session.dukkan_slug || null,
                dukkanId: session.dukkan_id || null
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Oturum bilgisi okunamadi.' });
    }
});

app.post('/api/logout', (req, res) => {
    sessionCookieSil(res);
    res.json({ status: 'success' });
});

app.post('/api/dukkan-ekle', apiYetkiGerekli(['superadmin', 'sÃ¼peradmin']), async (req, res) => {
    const { ad, slug, tur, adminUser, adminPass, telefon, adres, aciklama } = req.body;

    try {
        const sifreHatasi = sifrePolitikasiHatasi(adminPass, adminUser);
        if (sifreHatasi) return res.status(400).json({ error: sifreHatasi });

        const { data: existing } = await supabase.from('dukkanlar').select('id').eq('slug', slug).single();
        if (existing) return res.status(400).json({ error: 'Bu URL zaten kullanimda!' });

        const yeniDukkan = { ad, slug, tur };
        if (opsiyonelMetin(telefon)) yeniDukkan.telefon = opsiyonelMetin(telefon);
        if (opsiyonelMetin(adres)) yeniDukkan.adres = opsiyonelMetin(adres);
        if (opsiyonelMetin(aciklama)) yeniDukkan.aciklama = opsiyonelMetin(aciklama);

        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .insert([yeniDukkan])
            .select();

        if (dukkanErr) {
            if (tanitimKolonuEksikMi(dukkanErr)) {
                return res.status(400).json({ error: "Dukkan tanitim kolonlari eksik. Supabase'de telefon, adres ve aciklama kolonlarini olusturun." });
            }
            throw dukkanErr;
        }

        const { error: personelErr } = await supabase
            .from('personel')
            .insert([{
                dukkan_id: dukkan[0].id,
                kullanici_id: adminUser,
                sifre: sifreHashle(adminPass),
                rol: 'admin'
            }]);

        if (personelErr) throw personelErr;

        res.json({ status: 'success' });
    } catch (err) {
        console.error('SUNUCU HATASI:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 2. DUKKAN, LISTELEME VE GIRIS ROTALARI ---


// --- SUPER ADMIN YONETIM API'LERI ---

app.get('/api/superadmin/dukkanlar', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('dukkanlar')
            .select(DUKKAN_KOLONLARI)
            .order('id', { ascending: false });

        if (error) throw error;
        res.json((data || []).map(dukkanGorselleriniNormalle));
    } catch (err) {
        res.status(500).json({ error: err.message || 'Dukkan listesi alinamadi.' });
    }
});

app.get('/api/superadmin/personeller', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const { data: personeller, error: personelErr } = await supabase
            .from('personel')
            .select('id, kullanici_id, rol, dukkan_id')
            .order('id', { ascending: false });
        if (personelErr) throw personelErr;

        const dukkanIdleri = [...new Set((personeller || []).map(p => p.dukkan_id).filter(Boolean))];
        let dukkanMap = new Map();
        if (dukkanIdleri.length) {
            const { data: dukkanlar, error: dukkanErr } = await supabase
                .from('dukkanlar')
                .select('id, ad, slug')
                .in('id', dukkanIdleri);
            if (dukkanErr) throw dukkanErr;
            dukkanMap = new Map((dukkanlar || []).map(d => [Number(d.id), d]));
        }

        res.json((personeller || []).map(personel => {
            const dukkan = dukkanMap.get(Number(personel.dukkan_id));
            return {
                ...personel,
                dukkan_ad: dukkan?.ad || null,
                dukkan_slug: dukkan?.slug || null
            };
        }));
    } catch (err) {
        res.status(500).json({ error: err.message || 'Personel listesi alinamadi.' });
    }
});

app.get('/api/superadmin/dukkan-qr/:slug', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const slug = String(req.params.slug || '').trim();
        const publicUrl = siteBaseUrl(req) + '/' + encodeURIComponent(slug);
        const png = await QRCode.toBuffer(publicUrl, { type: 'png', width: 640, margin: 2 });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.send(png);
    } catch (err) {
        res.status(500).json({ error: err.message || 'QR olusturulamadi.' });
    }
});

app.get('/api/superadmin/dukkan-qr-listesi', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('dukkanlar')
            .select('id, ad, slug, tur')
            .order('id', { ascending: false });
        if (error) throw error;

        res.json((data || []).map(dukkan => {
            const slug = dukkan.slug || String(dukkan.id);
            const publicUrl = siteBaseUrl(req) + '/' + encodeURIComponent(slug);
            const qrUrl = '/api/superadmin/dukkan-qr/' + encodeURIComponent(slug);
            return {
                ...dukkan,
                public_url: publicUrl,
                qr_url: qrUrl,
                qr_download_url: qrUrl
            };
        }));
    } catch (err) {
        res.status(500).json({ error: err.message || 'QR listesi alinamadi.' });
    }
});

app.put('/api/superadmin/dukkan/:id', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const payload = {
            ad: String(req.body?.ad || '').trim(),
            slug: String(req.body?.slug || '').trim(),
            tur: String(req.body?.tur || '').trim(),
            telefon: opsiyonelMetin(req.body?.telefon),
            adres: opsiyonelMetin(req.body?.adres),
            aciklama: opsiyonelMetin(req.body?.aciklama)
        };

        if (!payload.ad || !payload.slug || !payload.tur) {
            return res.status(400).json({ error: 'Dukkan adi, slug ve sektor zorunlu.' });
        }

        const { data: ayniSlug, error: slugErr } = await supabase
            .from('dukkanlar')
            .select('id')
            .eq('slug', payload.slug)
            .neq('id', req.params.id)
            .maybeSingle();
        if (slugErr) throw slugErr;
        if (ayniSlug) return res.status(400).json({ error: 'Bu slug baska bir dukkanda kullaniliyor.' });

        const { error } = await supabase
            .from('dukkanlar')
            .update(payload)
            .eq('id', req.params.id);
        if (error) throw error;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Dukkan guncellenemedi.' });
    }
});

app.delete('/api/superadmin/dukkan/:id', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    const dukkanId = Number(req.params.id);
    try {
        if (!dukkanId) return res.status(400).json({ error: 'Gecersiz dukkan id.' });

        const { data: siparisler } = await supabase.from('siparisler').select('id').eq('dukkan_id', dukkanId);
        const siparisIdleri = (siparisler || []).map(s => s.id);
        if (siparisIdleri.length) {
            const { error } = await supabase.from('siparis_detaylari').delete().in('siparis_id', siparisIdleri);
            if (error) throw error;
        }

        for (const tablo of ['rezervasyonlar', 'stok_hareketleri', 'giderler', 'siparisler', 'urunler', 'ogeler', 'mesajlar', 'personel']) {
            const { error } = await supabase.from(tablo).delete().eq('dukkan_id', dukkanId);
            if (error && error.code !== '42P01') throw error;
        }

        const { error: dukkanErr } = await supabase.from('dukkanlar').delete().eq('id', dukkanId);
        if (dukkanErr) throw dukkanErr;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Dukkan silinemedi.' });
    }
});

app.post('/api/superadmin/personel', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const kullanici_id = String(req.body?.kullanici_id || '').trim();
        const rol = String(req.body?.rol || '').trim();
        const dukkan_id = Number(req.body?.dukkan_id || 0);
        const sifre = String(req.body?.sifre || '');

        if (!kullanici_id || !rol || !dukkan_id || !sifre) {
            return res.status(400).json({ error: 'Kullanici adi, rol, dukkan ve sifre zorunlu.' });
        }

        const sifreHatasi = sifrePolitikasiHatasi(sifre, kullanici_id);
        if (sifreHatasi) return res.status(400).json({ error: sifreHatasi });

        const { data: mevcut, error: mevcutErr } = await supabase
            .from('personel')
            .select('id')
            .ilike('kullanici_id', kullanici_id)
            .maybeSingle();
        if (mevcutErr) throw mevcutErr;
        if (mevcut) return res.status(400).json({ error: 'Bu kullanici adi zaten kullaniliyor.' });

        const { error } = await supabase
            .from('personel')
            .insert([{ dukkan_id, kullanici_id, rol, sifre: sifreHashle(sifre) }]);
        if (error) throw error;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Personel olusturulamadi.' });
    }
});

app.put('/api/superadmin/personel/:id', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const kullanici_id = String(req.body?.kullanici_id || '').trim();
        const rol = String(req.body?.rol || '').trim();
        const sifre = String(req.body?.sifre || '');

        if (!id || !kullanici_id || !rol) {
            return res.status(400).json({ error: 'Personel icin kullanici adi ve rol zorunlu.' });
        }

        const { data: mevcut, error: mevcutErr } = await supabase
            .from('personel')
            .select('id')
            .ilike('kullanici_id', kullanici_id)
            .neq('id', id)
            .maybeSingle();
        if (mevcutErr) throw mevcutErr;
        if (mevcut) return res.status(400).json({ error: 'Bu kullanici adi zaten kullaniliyor.' });

        const payload = { kullanici_id, rol };
        if (sifre) {
            const sifreHatasi = sifrePolitikasiHatasi(sifre, kullanici_id);
            if (sifreHatasi) return res.status(400).json({ error: sifreHatasi });
            payload.sifre = sifreHashle(sifre);
        }

        const { error } = await supabase
            .from('personel')
            .update(payload)
            .eq('id', id);
        if (error) throw error;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Personel guncellenemedi.' });
    }
});

app.delete('/api/superadmin/personel/:id', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const { error } = await supabase.from('personel').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Personel silinemedi.' });
    }
});

app.get('/api/superadmin/mesajlar', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('mesajlar')
            .select('id, dukkan_id, gonderen_rol, gonderen_adi, mesaj_turu, baslik, icerik, ust_mesaj_id, onemli, okundu, created_at, dukkanlar(ad, slug)')
            .order('id', { ascending: false });
        if (error) throw error;

        res.json((data || []).map(mesaj => ({
            ...mesaj,
            dukkan_ad: mesaj.dukkanlar?.ad || null,
            dukkan_slug: mesaj.dukkanlar?.slug || null
        })));
    } catch (err) {
        res.status(500).json({ error: err.message || 'Mesajlar alinamadi.' });
    }
});

app.post('/api/superadmin/mesaj-gonder', apiYetkiGerekli(['superadmin', 'süperadmin']), async (req, res) => {
    try {
        const hedefler = Array.isArray(req.body?.dukkan_ids) ? req.body.dukkan_ids.map(Number).filter(Boolean) : [];
        const icerik = String(req.body?.icerik || '').trim();
        if (!hedefler.length || !icerik) {
            return res.status(400).json({ error: 'Hedef dukkan ve mesaj icerigi zorunlu.' });
        }

        const kayitlar = hedefler.map(dukkan_id => ({
            dukkan_id,
            gonderen_rol: 'superadmin',
            gonderen_adi: req.session.kullanici_id || 'Super Admin',
            mesaj_turu: req.body?.mesaj_turu || 'duyuru',
            baslik: opsiyonelMetin(req.body?.baslik),
            icerik,
            ust_mesaj_id: req.body?.ust_mesaj_id || null,
            onemli: Boolean(req.body?.onemli),
            okundu: false
        }));

        const { error } = await supabase.from('mesajlar').insert(kayitlar);
        if (error) throw error;
        res.json({ status: 'success', adet: kayitlar.length });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Mesaj gonderilemedi.' });
    }
});

app.get('/api/:dukkan_adi/mesajlar', apiYetkiGerekli(['admin', 'superadmin', 'süperadmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data, error } = await supabase
            .from('mesajlar')
            .select('id, dukkan_id, gonderen_rol, gonderen_adi, mesaj_turu, baslik, icerik, ust_mesaj_id, onemli, okundu, created_at')
            .eq('dukkan_id', dukkan.id)
            .order('id', { ascending: false });
        if (error) throw error;

        res.json({ mesajlar: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Mesajlar alinamadi.' });
    }
});

app.post('/api/:dukkan_adi/mesaj-gonder', apiYetkiGerekli(['admin', 'superadmin', 'süperadmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const icerik = String(req.body?.icerik || '').trim();
        if (!icerik) return res.status(400).json({ error: 'Mesaj icerigi zorunlu.' });

        const { error } = await supabase.from('mesajlar').insert([{
            dukkan_id: dukkan.id,
            gonderen_rol: req.session.rol || 'admin',
            gonderen_adi: req.session.kullanici_id || 'Admin',
            mesaj_turu: req.body?.ust_mesaj_id ? 'yanit' : 'mesaj',
            baslik: opsiyonelMetin(req.body?.baslik),
            icerik,
            ust_mesaj_id: req.body?.ust_mesaj_id || null,
            onemli: false,
            okundu: false
        }]);
        if (error) throw error;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Mesaj gonderilemedi.' });
    }
});

app.get('/api/dukkanlar/listele', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('dukkanlar')
            .select(DUKKAN_KOLONLARI)
            .order('id', { ascending: true });

        if (error) {
            if (tanitimKolonuEksikMi(error) || gorselKolonuEksikMi(error)) {
                const { data: sade, error: sadeErr } = await supabase
                    .from('dukkanlar')
                    .select('id, slug, ad, tur')
                    .order('id', { ascending: true });

                if (sadeErr) throw sadeErr;
                return res.json(sade || []);
            }

            throw error;
        }

        res.json((data || []).map(dukkanGorselleriniNormalle));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dukkan-veri/:slug', async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.slug);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        let ogeler = [];
        if (restoranTuruMu(dukkan.tur)) {
            const { data: urunler, error: urunErr } = await supabase
                .from('urunler')
                .select('*')
                .eq('dukkan_id', dukkan.id)
                .order('id', { ascending: false });

            if (urunErr) throw urunErr;
            ogeler = urunler || [];
        }

        res.json({
            ...dukkan,
            dukkan,
            ogeler
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/vitrin', async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data: ogeler, error } = await supabase
            .from('ogeler')
            .select('id, dukkan_id, ad, detay, fiyat, tur')
            .eq('dukkan_id', dukkan.id)
            .order('id', { ascending: true });

        if (error) throw error;

        res.json({
            dukkan,
            ogeler: ogeler || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/rezervasyonlar/:ogeId', async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data, error } = await supabase
            .from('rezervasyonlar')
            .select('id, oge_id, baslangic_tarihi, bitis_tarihi, durum')
            .eq('dukkan_id', dukkan.id)
            .eq('oge_id', Number(req.params.ogeId))
            .neq('durum', 'iptal')
            .order('baslangic_tarihi', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/admin-bilgi', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        res.json({
            dukkan,
            restoranMi: restoranTuruMu(dukkan.tur)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/dukkan-bilgileri', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        res.json({ dukkan });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/:dukkan_adi/dukkan-bilgileri', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const payload = {
            ad: String(req.body?.ad || '').trim(),
            telefon: opsiyonelMetin(req.body?.telefon),
            adres: opsiyonelMetin(req.body?.adres),
            aciklama: opsiyonelMetin(req.body?.aciklama),
            logo_url: null,
            arka_plan_url: null
        };

        if (!payload.ad) return res.status(400).json({ error: 'Dukkan adi zorunlu.' });

        const { data, error } = await supabase
            .from('dukkanlar')
            .update(payload)
            .eq('id', dukkan.id)
            .select(DUKKAN_KOLONLARI)
            .single();

        if (error) {
            if (tanitimKolonuEksikMi(error)) {
                return res.status(400).json({ error: "Telefon, adres ve aciklama kolonlari eksik. Once Supabase tarafini tamamlayin." });
            }
            throw error;
        }

        res.json({
            status: 'success',
            dukkan: dukkanGorselleriniNormalle(data)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/ogeler', apiYetkiGerekli(['admin', 'garson', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data, error } = await supabase
            .from('ogeler')
            .select('*')
            .eq('dukkan_id', dukkan.id)
            .order('id', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/rezervasyon-yonetim', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data: ogeler, error: ogeErr } = await supabase
            .from('ogeler')
            .select('id, ad, tur, detay, fiyat')
            .eq('dukkan_id', dukkan.id)
            .order('id', { ascending: true });

        if (ogeErr) throw ogeErr;

        const { data: rezervasyonlar, error: rezervasyonErr } = await supabase
            .from('rezervasyonlar')
            .select('*')
            .eq('dukkan_id', dukkan.id)
            .order('baslangic_tarihi', { ascending: true });

        if (rezervasyonErr) throw rezervasyonErr;

        const { data: personeller, error: personelErr } = await supabase
            .from('personel')
            .select('id, kullanici_id, rol')
            .eq('dukkan_id', dukkan.id)
            .order('id', { ascending: true });

        if (personelErr) throw personelErr;

        const sahaPersonelleri = (personeller || []).filter(p => {
            const rol = rolTemizle(p.rol);
            return rol !== 'admin' && rol !== 'superadmin' && rol !== 'süperadmin';
        });

        res.json({
            ogeler: ogeler || [],
            personeller: sahaPersonelleri,
            rezervasyonlar: rezervasyonlar || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/:dukkan_adi/rezervasyon-ekle', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { oge_id, musteri_ad, musteri_telefon, baslangic_tarihi, bitis_tarihi, toplam_tutar, personel_id, durum, notlar } = req.body || {};

    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });
        if (!oge_id || !musteri_ad || !baslangic_tarihi || !bitis_tarihi) {
            return res.status(400).json({ error: 'Varlik, musteri ve tarih bilgileri zorunlu.' });
        }

        let seciliPersonel = null;
        if (personel_id) {
            const { data: personel, error: personelErr } = await supabase
                .from('personel')
                .select('id, kullanici_id')
                .eq('id', Number(personel_id))
                .eq('dukkan_id', dukkan.id)
                .maybeSingle();
            if (personelErr) throw personelErr;
            seciliPersonel = personel || null;
        }

        const rezervasyonPayload = {
            dukkan_id: dukkan.id,
            oge_id: Number(oge_id),
            musteri_ad,
            musteri_telefon: musteri_telefon || null,
            baslangic_tarihi,
            bitis_tarihi,
            toplam_tutar: Number(toplam_tutar || 0),
            personel_id: seciliPersonel?.id || null,
            personel_adi: seciliPersonel?.kullanici_id || null,
            durum: durum || 'aktif',
            notlar: notlar || null
        };

        let { data, error } = await supabase
            .from('rezervasyonlar')
            .insert([rezervasyonPayload])
            .select()
            .single();

        if (error && rezervasyonPersonelKolonuEksikMi(error)) {
            delete rezervasyonPayload.personel_id;
            delete rezervasyonPayload.personel_adi;
            const ikinci = await supabase.from('rezervasyonlar').insert([rezervasyonPayload]).select().single();
            data = ikinci.data;
            error = ikinci.error;
        }

        if (error) throw error;

        if (Number(toplam_tutar || 0) > 0 && String(durum || 'aktif').toLocaleLowerCase('tr-TR').trim() !== 'iptal') {
            const { data: oge } = await supabase
                .from('ogeler')
                .select('id, ad')
                .eq('id', Number(oge_id))
                .eq('dukkan_id', dukkan.id)
                .maybeSingle();
            const gelirPayload = {
                dukkan_id: dukkan.id,
                baslik: `Rezervasyon #${data.id} - ${musteri_ad}`,
                kategori: 'Gelir',
                tutar: Number(toplam_tutar || 0),
                oge_id: oge?.id || Number(oge_id),
                oge_adi: oge?.ad || null
            };
            let gelirSonuc = await supabase.from('giderler').insert([gelirPayload]);
            if (gelirSonuc.error && giderOgeKolonuEksikMi(gelirSonuc.error)) {
                delete gelirPayload.oge_id;
                delete gelirPayload.oge_adi;
                gelirSonuc = await supabase.from('giderler').insert([gelirPayload]);
            }

            if (gelirSonuc.error) throw gelirSonuc.error;
        }

        res.json({ status: 'success', rezervasyon: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/:dukkan_adi/rezervasyon/:id/iptal', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .select('id')
            .eq('slug', req.params.dukkan_adi)
            .single();

        if (dukkanErr || !dukkan) return res.status(404).json({ error: "Dukkan bulunamadi" });

        const { data: mevcutRezervasyon, error: mevcutRezErr } = await supabase
            .from('rezervasyonlar')
            .select('id, musteri_ad')
            .eq('id', req.params.id)
            .eq('dukkan_id', dukkan.id)
            .single();

        if (mevcutRezErr || !mevcutRezervasyon) return res.status(404).json({ error: "Rezervasyon bulunamadi" });

        const { error } = await supabase
            .from('rezervasyonlar')
            .update({ durum: 'iptal' })
            .eq('id', req.params.id)
            .eq('dukkan_id', dukkan.id);

        if (error) throw error;

        const { error: gelirSilErr } = await supabase
            .from('giderler')
            .delete()
            .eq('dukkan_id', dukkan.id)
            .eq('kategori', 'Gelir')
            .eq('baslik', `Rezervasyon #${mevcutRezervasyon.id} - ${mevcutRezervasyon.musteri_ad}`);

        if (gelirSilErr) throw gelirSilErr;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


async function rezervasyonGelirKaydiniYenile(dukkanId, rezervasyon, ogeId) {
    const gelirBaslik = `Rezervasyon #${rezervasyon.id} - ${rezervasyon.musteri_ad}`;

    const { error: gelirTemizleErr } = await supabase
        .from('giderler')
        .delete()
        .eq('dukkan_id', dukkanId)
        .eq('kategori', 'Gelir')
        .like('baslik', `Rezervasyon #${rezervasyon.id} - %`);

    if (gelirTemizleErr) throw gelirTemizleErr;

    if (Number(rezervasyon.toplam_tutar || 0) <= 0) return;
    if (String(rezervasyon.durum || 'aktif').toLocaleLowerCase('tr-TR').trim() === 'iptal') return;

    const { data: oge } = await supabase
        .from('ogeler')
        .select('id, ad')
        .eq('id', Number(ogeId || rezervasyon.oge_id))
        .eq('dukkan_id', dukkanId)
        .maybeSingle();

    const gelirPayload = {
        dukkan_id: dukkanId,
        baslik: gelirBaslik,
        kategori: 'Gelir',
        tutar: Number(rezervasyon.toplam_tutar || 0),
        oge_id: oge?.id || Number(ogeId || rezervasyon.oge_id),
        oge_adi: oge?.ad || null
    };

    let gelirSonuc = await supabase.from('giderler').insert([gelirPayload]);
    if (gelirSonuc.error && giderOgeKolonuEksikMi(gelirSonuc.error)) {
        delete gelirPayload.oge_id;
        delete gelirPayload.oge_adi;
        gelirSonuc = await supabase.from('giderler').insert([gelirPayload]);
    }

    if (gelirSonuc.error) throw gelirSonuc.error;
}

app.patch('/api/:dukkan_adi/rezervasyon/:id', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { oge_id, musteri_ad, musteri_telefon, baslangic_tarihi, bitis_tarihi, toplam_tutar, personel_id, durum, notlar } = req.body || {};

    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });
        if (!oge_id || !musteri_ad || !baslangic_tarihi || !bitis_tarihi) {
            return res.status(400).json({ error: 'Varlik, musteri ve tarih bilgileri zorunlu.' });
        }

        const { data: mevcutRezervasyon, error: mevcutRezErr } = await supabase
            .from('rezervasyonlar')
            .select('id')
            .eq('id', req.params.id)
            .eq('dukkan_id', dukkan.id)
            .single();

        if (mevcutRezErr || !mevcutRezervasyon) return res.status(404).json({ error: 'Rezervasyon bulunamadi.' });

        let seciliPersonel = null;
        if (personel_id) {
            const { data: personel, error: personelErr } = await supabase
                .from('personel')
                .select('id, kullanici_id')
                .eq('id', Number(personel_id))
                .eq('dukkan_id', dukkan.id)
                .maybeSingle();
            if (personelErr) throw personelErr;
            seciliPersonel = personel || null;
        }

        const payload = {
            oge_id: Number(oge_id),
            musteri_ad,
            musteri_telefon: musteri_telefon || null,
            baslangic_tarihi,
            bitis_tarihi,
            toplam_tutar: Number(toplam_tutar || 0),
            personel_id: seciliPersonel?.id || null,
            personel_adi: seciliPersonel?.kullanici_id || null,
            durum: durum || 'aktif',
            notlar: notlar || null
        };

        let { data, error } = await supabase
            .from('rezervasyonlar')
            .update(payload)
            .eq('id', req.params.id)
            .eq('dukkan_id', dukkan.id)
            .select()
            .single();

        if (error && rezervasyonPersonelKolonuEksikMi(error)) {
            delete payload.personel_id;
            delete payload.personel_adi;
            const ikinci = await supabase
                .from('rezervasyonlar')
                .update(payload)
                .eq('id', req.params.id)
                .eq('dukkan_id', dukkan.id)
                .select()
                .single();
            data = ikinci.data;
            error = ikinci.error;
        }

        if (error) throw error;

        await rezervasyonGelirKaydiniYenile(dukkan.id, data, oge_id);

        res.json({ status: 'success', rezervasyon: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/:dukkan_adi/rezervasyon/:id', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data: mevcutRezervasyon, error: mevcutRezErr } = await supabase
            .from('rezervasyonlar')
            .select('id')
            .eq('id', req.params.id)
            .eq('dukkan_id', dukkan.id)
            .single();

        if (mevcutRezErr || !mevcutRezervasyon) return res.status(404).json({ error: 'Rezervasyon bulunamadi.' });

        const { error: gelirSilErr } = await supabase
            .from('giderler')
            .delete()
            .eq('dukkan_id', dukkan.id)
            .eq('kategori', 'Gelir')
            .like('baslik', `Rezervasyon #${req.params.id} - %`);

        if (gelirSilErr) throw gelirSilErr;

        const { error } = await supabase
            .from('rezervasyonlar')
            .delete()
            .eq('id', req.params.id)
            .eq('dukkan_id', dukkan.id);

        if (error) throw error;

        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/:dukkan_adi/admin', yetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/:dukkan_adi/garson', yetkiGerekli(['garson', 'admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.redirect('/');
        if (!restoranTuruMu(dukkan.tur)) return res.redirect(`/${req.params.dukkan_adi}/admin`);

        htmlCacheKapat(res);
        res.sendFile(path.join(__dirname, 'garson.html'));
    } catch (err) {
        res.redirect('/');
    }
});

app.get('/:dukkan_adi', async (req, res, next) => {
    const slug = req.params.dukkan_adi;
    if (!slug || slug === 'api' || slug === 'super-admin' || slug === 'superadmin') return next();

    try {
        const dukkan = await dukkanBilgisiBulBySlug(slug);
        if (!dukkan) {
            htmlCacheKapat(res);
            return res.status(404).sendFile(path.join(__dirname, 'index.html'));
        }

        const hedefDosya = restoranTuruMu(dukkan.tur)
            ? path.join(__dirname, 'public', 'menu.html')
            : path.join(__dirname, 'public', 'vitrin.html');

        htmlCacheKapat(res);
        res.sendFile(hedefDosya);
    } catch (err) {
        htmlCacheKapat(res);
        res.status(500).sendFile(path.join(__dirname, 'index.html'));
    }
});


app.get('/api/:dukkan_adi/ozet', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .select('id, tur')
            .eq('slug', req.params.dukkan_adi)
            .single();

        if (dukkanErr || !dukkan) return res.status(404).json({ error: "Dukkan bulunamadi" });

        const now = new Date();
        const bugunBaslangic = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yarinBaslangic = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const ayBaslangic = new Date(now.getFullYear(), now.getMonth(), 1);
        const gelecekAyBaslangic = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        const kaynakTablo = restoranTuruMu(dukkan.tur) ? 'siparisler' : 'rezervasyonlar';
        const aktifDurumKontrolu = restoranTuruMu(dukkan.tur)
            ? (durum) => String(durum || '').toLocaleLowerCase('tr-TR').trim() === 'aÃ§Ä±k'
            : (durum) => String(durum || '').toLocaleLowerCase('tr-TR').trim() !== 'iptal';

        const { data: bugunKayitlari, error: bugunErr } = await supabase
            .from(kaynakTablo)
            .select('toplam_tutar')
            .eq('dukkan_id', dukkan.id)
            .gte('created_at', bugunBaslangic.toISOString())
            .lt('created_at', yarinBaslangic.toISOString());

        if (bugunErr) throw bugunErr;

        const { data: ayKayitlari, error: ayErr } = await supabase
            .from(kaynakTablo)
            .select('toplam_tutar')
            .eq('dukkan_id', dukkan.id)
            .gte('created_at', ayBaslangic.toISOString())
            .lt('created_at', gelecekAyBaslangic.toISOString());

        if (ayErr) throw ayErr;

        const { data: acikKayitlar, error: acikErr } = await supabase
            .from(kaynakTablo)
            .select('id, durum')
            .eq('dukkan_id', dukkan.id);

        if (acikErr) throw acikErr;

        const toplam = (liste) => (liste || []).reduce((sum, item) => sum + Number(item.toplam_tutar || 0), 0);

        res.json({
            gunlukCiro: toplam(bugunKayitlari),
            aylikCiro: toplam(ayKayitlari),
            acikSiparisSayisi: (acikKayitlar || []).filter(k => aktifDurumKontrolu(k.durum)).length
        });
    } catch (err) {
        console.error("Ozet verisi alinirken hata:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/gelir-gider', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .select('id, tur')
            .eq('slug', req.params.dukkan_adi)
            .single();

        if (dukkanErr || !dukkan) return res.status(404).json({ error: "Dukkan bulunamadi" });

        const ayAraligi = ayAraligiHazirla(req.query?.ay);
        let { data: kayitlar, error } = await supabase
            .from('giderler')
            .select('id, baslik, kategori, tutar, created_at, oge_id, oge_adi')
            .eq('dukkan_id', dukkan.id)
            .gte('created_at', ayAraligi.baslangic.toISOString())
            .lt('created_at', ayAraligi.bitis.toISOString())
            .order('created_at', { ascending: false });

        if (error && giderOgeKolonuEksikMi(error)) {
            const ikinci = await supabase
                .from('giderler')
                .select('id, baslik, kategori, tutar, created_at')
                .eq('dukkan_id', dukkan.id)
                .gte('created_at', ayAraligi.baslangic.toISOString())
                .lt('created_at', ayAraligi.bitis.toISOString())
                .order('created_at', { ascending: false });
            kayitlar = (ikinci.data || []).map(k => ({ ...k, oge_id: null, oge_adi: null }));
            error = ikinci.error;
        }

        if (error) throw error;

        const kategoriNorm = (kategori) => String(kategori || '').toLocaleLowerCase('tr-TR').trim();
        const durumNorm = (durum) => String(durum || '').toLocaleLowerCase('tr-TR').trim();
        const toplam = (liste) => liste.reduce((sum, item) => sum + Number(item.tutar || item.toplam_tutar || 0), 0);

        let gelirler = (kayitlar || []).filter(k => kategoriNorm(k.kategori) === 'gelir');
        const giderler = (kayitlar || []).filter(k => kategoriNorm(k.kategori) !== 'gelir');

        if (!gelirler.length) {
            if (restoranTuruMu(dukkan.tur)) {
                const { data: siparisler, error: siparisErr } = await supabase
                    .from('siparisler')
                    .select('id, toplam_tutar, created_at, durum')
                    .eq('dukkan_id', dukkan.id)
                    .gte('created_at', ayAraligi.baslangic.toISOString())
                    .lt('created_at', ayAraligi.bitis.toISOString());

                if (siparisErr) throw siparisErr;

                gelirler = (siparisler || [])
                    .filter((siparis) => {
                        const durum = durumNorm(siparis.durum);
                        return (durum === 'kapali' || durum === 'kapalı') && Number(siparis.toplam_tutar || 0) > 0;
                    })
                    .map((siparis) => ({
                        id: 'siparis-' + siparis.id,
                        baslik: 'Siparis #' + siparis.id + ' odemesi',
                        kategori: 'Gelir',
                        tutar: Number(siparis.toplam_tutar || 0),
                        created_at: siparis.created_at
                    }));
            } else {
                const { data: rezervasyonlar, error: rezervasyonErr } = await supabase
                    .from('rezervasyonlar')
                    .select('id, toplam_tutar, created_at, durum, musteri_ad')
                    .eq('dukkan_id', dukkan.id)
                    .gte('created_at', ayAraligi.baslangic.toISOString())
                    .lt('created_at', ayAraligi.bitis.toISOString());

                if (rezervasyonErr) throw rezervasyonErr;

                gelirler = (rezervasyonlar || [])
                    .filter((rezervasyon) => durumNorm(rezervasyon.durum) !== 'iptal' && Number(rezervasyon.toplam_tutar || 0) > 0)
                    .map((rezervasyon) => ({
                        id: 'rezervasyon-' + rezervasyon.id,
                        baslik: rezervasyon.musteri_ad ? rezervasyon.musteri_ad + ' rezervasyonu' : 'Rezervasyon #' + rezervasyon.id,
                        kategori: 'Gelir',
                        tutar: Number(rezervasyon.toplam_tutar || 0),
                        created_at: rezervasyon.created_at
                    }));
            }
        }

        gelirler.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        const toplamGelir = toplam(gelirler);
        const toplamGider = toplam(giderler);

        res.json({
            gelirler,
            giderler,
            toplamGelir,
            toplamGider,
            netSonuc: toplamGelir - toplamGider
        });
    } catch (err) {
        console.error("Gelir gider verisi alinirken hata:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/:dukkan_adi/gelir-gider/kayit', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const kategoriRaw = String(req.body?.kategori || '').trim();
    const baslik = String(req.body?.baslik || '').trim();
    const tutar = Number(req.body?.tutar || 0);
    const ogeId = req.body?.oge_id ? Number(req.body.oge_id) : null;

    try {
        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .select('id')
            .eq('slug', req.params.dukkan_adi)
            .single();

        if (dukkanErr || !dukkan) return res.status(404).json({ error: "Dukkan bulunamadi" });
        if (!baslik || tutar <= 0) return res.status(400).json({ error: "Baslik ve pozitif tutar zorunlu." });

        const kategoriNorm = kategoriRaw.toLocaleLowerCase('tr-TR');
        const kategori = kategoriNorm === 'gelir' ? 'Gelir' : 'Gider';

        let seciliOge = null;
        if (ogeId) {
            const { data: oge, error: ogeErr } = await supabase
                .from('ogeler')
                .select('id, ad')
                .eq('id', ogeId)
                .eq('dukkan_id', dukkan.id)
                .maybeSingle();
            if (ogeErr) throw ogeErr;
            seciliOge = oge || null;
        }

        const payload = {
            dukkan_id: dukkan.id,
            baslik,
            kategori,
            tutar,
            oge_id: seciliOge?.id || null,
            oge_adi: seciliOge?.ad || null
        };

        let sonuc = await supabase
            .from('giderler')
            .insert([payload])
            .select('id, baslik, kategori, tutar, created_at, oge_id, oge_adi')
            .single();

        if (sonuc.error && giderOgeKolonuEksikMi(sonuc.error)) {
            delete payload.oge_id;
            delete payload.oge_adi;
            sonuc = await supabase
                .from('giderler')
                .insert([payload])
                .select('id, baslik, kategori, tutar, created_at')
                .single();
        }

        if (sonuc.error) throw sonuc.error;
        res.json({ status: "success", kayit: sonuc.data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/:dukkan_adi/yeniOgeEkle', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { ad, tur, detay, fiyat } = req.body;
    try {
        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadÄ±" });

        const { error } = await supabase
            .from('ogeler')
            .insert([{
                dukkan_id: dukkan.id,
                ad,
                tur,
                detay: detay || null,
                fiyat: fiyat === null || fiyat === undefined || fiyat === '' ? null : Number(fiyat)
            }]);

        if (error) throw error;
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/:dukkan_adi/oge-guncelle/:id', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { ad, tur, detay, fiyat } = req.body;

    try {
        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .select('id')
            .eq('slug', req.params.dukkan_adi)
            .single();
        if (dukkanErr || !dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadÄ±" });

        const guncel = {
            ad: opsiyonelMetin(ad),
            tur: opsiyonelMetin(tur),
            detay: opsiyonelMetin(detay),
            fiyat: fiyat === null || fiyat === undefined || fiyat === '' ? null : Number(fiyat)
        };

        const { error } = await supabase
            .from('ogeler')
            .update(guncel)
            .eq('id', Number(req.params.id))
            .eq('dukkan_id', dukkan.id);

        if (error) throw error;
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// â˜• 3. MODÃœL: ÃœrÃ¼nleri (Ã‡ay/Ã‡orba/Paket) Listeleme KapÄ±sÄ±
app.get('/api/:dukkan_adi/urunler', apiYetkiGerekli(['admin', 'garson', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadÄ±" });

        const { data: urunler, error } = await supabase
            .from('urunler')
            .select('*')
            .eq('dukkan_id', dukkan.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(urunler);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// â• 4. MODÃœL: KataloÄŸa Yeni ÃœrÃ¼n Ekleme KapÄ±sÄ±
app.post('/api/:dukkan_adi/urun-ekle', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { ad, tur, detay, fiyat, stok_takibi, stok_miktar, kdv_orani } = req.body;
    try {
        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadÄ±" });

        const { error } = await supabase
            .from('urunler')
            .insert([{
                dukkan_id: dukkan.id,
                ad,
                tur,
                detay,
                fiyat: Number(fiyat),
                stok_takibi: !!stok_takibi,
                stok_miktar: stok_takibi ? Number(stok_miktar || 0) : null,
                kdv_orani: Number(kdv_orani || 0)
            }]);

        if (error) throw error;
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/:dukkan_adi/urun-guncelle/:id', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { ad, tur, detay, fiyat, stok_takibi, stok_miktar, kdv_orani } = req.body;
    try {
        const guncelVeri = { ad, tur, detay, fiyat: Number(fiyat), kdv_orani: Number(kdv_orani || 0) };
        if (stok_takibi !== undefined) guncelVeri.stok_takibi = !!stok_takibi;
        if (stok_miktar !== undefined) guncelVeri.stok_miktar = stok_takibi ? Number(stok_miktar || 0) : null;

        const { error } = await supabase
            .from('urunler')
            .update(guncelVeri)
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/ambar', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "Dukkan bulunamadi" });

        const { data, error } = await supabase
            .from('urunler')
            .select('id, ad, tur, fiyat, stok_miktar, stok_takibi')
            .eq('dukkan_id', dukkan.id)
            .eq('stok_takibi', true)
            .order('ad', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/:dukkan_adi/ambar/stok-giris', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { urun_id, miktar, alis_fiyati } = req.body;
    try {
        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "Dukkan bulunamadi" });

        const adet = Number(miktar || 0);
        const birimFiyat = Number(alis_fiyati || 0);
        if (!urun_id || adet <= 0) return res.status(400).json({ error: "Urun ve miktar zorunlu" });

        const { data: urun, error: urunErr } = await supabase
            .from('urunler')
            .select('id, ad, stok_miktar')
            .eq('id', urun_id)
            .eq('dukkan_id', dukkan.id)
            .single();

        if (urunErr || !urun) return res.status(404).json({ error: "Urun bulunamadi" });

        const yeniMiktar = Number(urun.stok_miktar || 0) + adet;
        const { error: stokErr } = await supabase
            .from('urunler')
            .update({ stok_miktar: yeniMiktar })
            .eq('id', urun.id);
        if (stokErr) throw stokErr;

        const { error: hareketErr } = await supabase
            .from('stok_hareketleri')
            .insert([{ dukkan_id: dukkan.id, urun_id: urun.id, miktar: adet, islem_turu: 'giris' }]);
        if (hareketErr) throw hareketErr;

        if (birimFiyat > 0) {
            const { error: giderErr } = await supabase
                .from('giderler')
                .insert([{ dukkan_id: dukkan.id, baslik: `${urun.ad} stok alimi`, kategori: 'Ambar', tutar: adet * birimFiyat }]);
            if (giderErr) throw giderErr;
        }

        res.json({ status: "success", stok_miktar: yeniMiktar });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.delete('/api/:dukkan_adi/urun-sil/:id', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('urunler') // Tablo adÄ±n 'urunler' ise aynen kalsÄ±n
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ğŸ‘¥ 5. MODÃœL: Personelleri Listeleme KapÄ±sÄ±
app.get('/api/:dukkan_adi/personeller', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadÄ±" });

        const { data: personeller, error } = await supabase
            .from('personel')
            .select('id, kullanici_id, rol') // Åifreyi Ã§ekmiyoruz, gÃ¼venlik Ã¶nlemi
            .eq('dukkan_id', dukkan.id);

        if (error) throw error;
        res.json(personeller);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// â• 6. MODÃœL: Yeni Personel (Garson/YÃ¶netici) Ekleme KapÄ±sÄ±
app.post('/api/:dukkan_adi/personel-ekle', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    const { kullanici_id, sifre, rol } = req.body;
    try {
        const sifreHatasi = sifrePolitikasiHatasi(sifre, kullanici_id);
        if (sifreHatasi) return res.status(400).json({ error: sifreHatasi });

        const { data: dukkan } = await supabase.from('dukkanlar').select('id').eq('slug', req.params.dukkan_adi).single();
        if (!dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadÄ±" });

        const { error } = await supabase
            .from('personel')
            .insert([{ dukkan_id: dukkan.id, kullanici_id, sifre: sifreHashle(sifre), rol }]);

        if (error) throw error;
        res.json({ status: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// C. JANJANLI MODALDAN GELEN SÄ°PARÄ°ÅÄ° VERÄ°TABANINA YAZMA / GÃœNCELLEME
app.post('/api/siparis/kaydet', apiYetkiGerekli(['garson', 'admin', 'superadmin', 'sÃ¼peradmin'], { dukkanIdEslesmeli: true }), async (req, res) => {
    const { dukkan_id, oge_id, masa_adi, toplam_tutar, durum, urunler, siparis_id } = req.body;
    const kaydedenPersonelId = req.session?.id || null;
    const kaydedenPersonelAdi = req.session?.kullanici_id || null;

    try {
        if (!dukkan_id || !oge_id) {
            return res.status(400).json({ error: "Dukkan ve masa bilgisi eksik." });
        }

        const detaylar = (urunler || [])
            .filter(u => u.urun_id && Number(u.adet) > 0)
            .map(u => ({
                urun_id: Number(u.urun_id),
                adet: Number(u.adet)
            }));

        const detayEkle = async (siparisKimligi) => {
            const eklenecekUrunler = detaylar.map(u => ({
                siparis_id: siparisKimligi,
                urun_id: u.urun_id,
                adet: u.adet,
                personel_id: kaydedenPersonelId,
                personel_adi: kaydedenPersonelAdi
            }));

            const ilkDeneme = await supabase
                .from('siparis_detaylari')
                .insert(eklenecekUrunler);

            if (!ilkDeneme.error) return null;
            if (!siparisDetayKolonuEksikMi(ilkDeneme.error)) return ilkDeneme.error;

            const sadeUrunler = detaylar.map(u => ({
                siparis_id: siparisKimligi,
                urun_id: u.urun_id,
                adet: u.adet
            }));
            const ikinciDeneme = await supabase
                .from('siparis_detaylari')
                .insert(sadeUrunler);

            return ikinciDeneme.error || null;
        };

        // SENARYO A: EÄER MASADA ZATEN AÃ‡IK HESAP VARSA VE GARSON SÄ°PARÄ°Å DEÄÄ°ÅTÄ°RDÄ°YSE
        if (siparis_id) {
            // 1. Ana sipariÅŸin tutarÄ±nÄ± gÃ¼ncelle
            const { error: anaGuncelleHata } = await supabase
                .from('siparisler')
                .update({ toplam_tutar: Number(toplam_tutar), durum: durum || 'aÃ§Ä±k' })
                .eq('id', siparis_id);

            if (anaGuncelleHata) throw anaGuncelleHata;

            // 2. Eski detaylarÄ± temizle
            const { error: eskiSilHata } = await supabase
                .from('siparis_detaylari')
                .delete()
                .eq('siparis_id', siparis_id);

            if (eskiSilHata) throw eskiSilHata;

            if (detaylar.length === 0) {
                return res.sendStatus(200);
            }

            // 3. Yeni detaylarÄ± ekle
            const detayEkleHata = await detayEkle(siparis_id);
            if (detayEkleHata) throw detayEkleHata;
            return res.sendStatus(200);
        } 
        
        // SENARYO B: MASA BOÅSA VE Ä°LK DEFA HESAP AÃ‡ILIYORSA
        else {
            if (detaylar.length === 0) {
                return res.status(400).json({ error: "Siparis icin en az bir urun gerekli." });
            }

            // 1. Ana sipariÅŸi ekle ve ID'sini al
            const { data: yeniSiparis, error: anaEkleHata } = await supabase
                .from('siparisler')
                .insert([{
                    dukkan_id: dukkan_id,
                    oge_id: Number(oge_id),
                    toplam_tutar: Number(toplam_tutar),
                    durum: durum || 'aÃ§Ä±k'
                }])
                .select()
                .single();

            if (anaEkleHata) throw anaEkleHata;

            // 2. DetaylarÄ± tek seferde tertemiz ekle
            const detayEkleHata = await detayEkle(yeniSiparis.id);
            if (detayEkleHata) throw detayEkleHata;
            return res.sendStatus(200);
        }
    } catch (err) {
        console.error("SipariÅŸ veritabanÄ± kayÄ±t hatasÄ±:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/operator-is-raporu', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const dukkan = await dukkanBilgisiBulBySlug(req.params.dukkan_adi);
        if (!dukkan) return res.status(404).json({ error: 'Dukkan bulunamadi.' });

        const { data: rezervasyonlar, error } = await supabase
            .from('rezervasyonlar')
            .select('id, oge_id, personel_id, personel_adi, toplam_tutar, durum')
            .eq('dukkan_id', dukkan.id);
        if (error) {
            if (rezervasyonPersonelKolonuEksikMi(error)) {
                return res.status(400).json({ error: 'Operator raporu icin rezervasyonlar tablosuna personel_id ve personel_adi kolonlari eklenmeli.' });
            }
            throw error;
        }

        const ogeIdleri = [...new Set((rezervasyonlar || []).map(r => r.oge_id).filter(Boolean))];
        let ogeMap = new Map();
        if (ogeIdleri.length) {
            const { data: ogeler, error: ogeErr } = await supabase
                .from('ogeler')
                .select('id, ad, tur')
                .in('id', ogeIdleri);
            if (ogeErr) throw ogeErr;
            ogeMap = new Map((ogeler || []).map(o => [Number(o.id), o]));
        }

        const toparla = new Map();
        for (const rezervasyon of rezervasyonlar || []) {
            const durum = String(rezervasyon.durum || '').toLocaleLowerCase('tr-TR').trim();
            if (durum === 'iptal' || !rezervasyon.personel_id) continue;
            const oge = ogeMap.get(Number(rezervasyon.oge_id));
            const anahtar = `${rezervasyon.personel_id}::${rezervasyon.oge_id || 'genel'}`;
            const mevcut = toparla.get(anahtar) || {
                personel_id: rezervasyon.personel_id,
                personel_adi: rezervasyon.personel_adi || 'Bilinmiyor',
                oge_id: rezervasyon.oge_id || null,
                oge_adi: oge?.ad || 'Birim',
                oge_tur: oge?.tur || 'Genel',
                is_adedi: 0,
                toplam_tutar: 0
            };
            mevcut.is_adedi += 1;
            mevcut.toplam_tutar += Number(rezervasyon.toplam_tutar || 0);
            toparla.set(anahtar, mevcut);
        }

        res.json([...toparla.values()].sort((a, b) => b.toplam_tutar - a.toplam_tutar));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/:dukkan_adi/personel-satis-raporu', apiYetkiGerekli(['admin', 'superadmin', 'sÃ¼peradmin'], { dukkanSlugEslesmeli: true }), async (req, res) => {
    try {
        const { data: dukkan, error: dukkanErr } = await supabase
            .from('dukkanlar')
            .select('id')
            .eq('slug', req.params.dukkan_adi)
            .single();

        if (dukkanErr || !dukkan) return res.status(404).json({ error: "DÃ¼kkan bulunamadi" });

        const { data: siparisler, error: siparisErr } = await supabase
            .from('siparisler')
            .select('id')
            .eq('dukkan_id', dukkan.id);
        if (siparisErr) throw siparisErr;

        const siparisIdler = (siparisler || []).map(s => s.id);
        if (!siparisIdler.length) return res.json([]);

        const { data, error } = await supabase
            .from('siparis_detaylari')
            .select('adet, personel_id, personel_adi, urun_id, urunler(id, ad, tur)')
            .in('siparis_id', siparisIdler);

        if (error) {
            if (siparisDetayKolonuEksikMi(error)) {
                return res.status(400).json({ error: "SatÄ±ÅŸ raporu iÃ§in siparis_detaylari tablosuna personel_id ve personel_adi kolonlarÄ± eklenmeli." });
            }
            throw error;
        }

        const toparla = new Map();
        for (const satir of data || []) {
            const personelAdi = satir.personel_adi || 'Bilinmiyor';
            const urunAdi = satir.urunler?.ad || 'Urun';
            const urunTur = satir.urunler?.tur || 'Genel';
            const anahtar = `${personelAdi}::${urunAdi}`;
            const mevcut = toparla.get(anahtar) || {
                personel_adi: personelAdi,
                urun_adi: urunAdi,
                urun_tur: urunTur,
                toplam_adet: 0
            };
            mevcut.toplam_adet += Number(satir.adet || 0);
            toparla.set(anahtar, mevcut);
        }

        const liste = [...toparla.values()].sort((a, b) => b.toplam_adet - a.toplam_adet);
        res.json(liste);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ==========================================
// SÄ°PARÄ°Å VE KASA YÃ–NETÄ°MÃœSSÃœ API ROTASI
// ==========================================

// 1. DÃœKKANA AÄ°T AKTÄ°F (AÃ‡IK) SÄ°PARÄ°ÅLERÄ° GETÄ°R
// Frontend: fetch(`/api/aktif-siparisler/${dukkanId}`)
app.get('/api/aktif-siparisler/:dukkanId', apiYetkiGerekli(['garson', 'admin', 'superadmin', 'sÃ¼peradmin'], { dukkanIdEslesmeli: true }), async (req, res) => {
    const { dukkanId } = req.params;
    try {
        // Durumu 'aÃ§Ä±k' olan, yani masada oturan mÃ¼ÅŸterilerin sipariÅŸlerini getiriyoruz
        const { data, error } = await supabase
            .from('siparisler')
            .select('*')
            .eq('dukkan_id', dukkanId)
            .eq('durum', 'aÃ§Ä±k');

        if (error) throw error;
        return res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: "Sunucu hatasÄ±" });
    }
});

// 2. SEÃ‡Ä°LEN MASANIN SÄ°PARÄ°Å DETAYLARINI (YENENLERÄ°) GETÄ°R
// Frontend: fetch(`/api/siparis-detay/${aktifSiparis.id}`)
app.get('/api/siparis-detay/:siparisId', apiYetkiGerekli(['garson', 'admin', 'superadmin', 'sÃ¼peradmin']), async (req, res) => {
    const { siparisId } = req.params;
    try {
        const { data: siparis, error: siparisErr } = await supabase
            .from('siparisler')
            .select('id, dukkan_id')
            .eq('id', siparisId)
            .single();

        if (siparisErr || !siparis) return res.status(404).json({ error: "Siparis bulunamadi" });

        const rol = rolTemizle(req.session?.rol);
        if (rol !== 'superadmin' && rol !== 'sÃ¼peradmin' && Number(req.session?.dukkan_id) !== Number(siparis.dukkan_id)) {
            return res.status(403).json({ error: "Bu siparis icin yetkiniz yok." });
        }

        const { data, error } = await supabase
            .from('siparis_detaylari')
            .select('id, siparis_id, urun_id, adet, urunler(id, ad, fiyat)')
            .eq('siparis_id', siparisId);

        if (error) throw error;

        return res.json((data || []).map(item => ({
            id: item.id,
            siparis_id: item.siparis_id,
            urun_id: item.urun_id,
            adet: item.adet,
            urun_adi: item.urunler?.ad || 'Urun',
            fiyat: Number(item.urunler?.fiyat || 0)
        })));
    } catch (error) {
        res.status(500).json({ error: "Sunucu hatasÄ±" });
    }
});

// 4. HESABI KAPAT / Ã–DEME AL (Masa BoÅŸaltma)
// Frontend: fetch(`/api/siparis/kapat/${siparisId}`, { method: 'POST' })
app.post('/api/siparis/kapat/:siparisId', apiYetkiGerekli(['garson', 'admin', 'superadmin', 'sÃ¼peradmin']), async (req, res) => {
    const { siparisId } = req.params;
    try {
        const { data: siparis, error: siparisErr } = await supabase
            .from('siparisler')
            .select('id, dukkan_id, toplam_tutar, durum')
            .eq('id', siparisId)
            .single();

        if (siparisErr || !siparis) return res.status(404).json({ error: "Siparis bulunamadi" });
        const rol = rolTemizle(req.session?.rol);
        if (rol !== 'superadmin' && rol !== 'sÃ¼peradmin' && Number(req.session?.dukkan_id) !== Number(siparis.dukkan_id)) {
            return res.status(403).json({ error: "Bu siparis icin yetkiniz yok." });
        }
        if (String(siparis.durum || '').toLocaleLowerCase('tr-TR').trim() === 'kapalÄ±') {
            return res.json({ success: true, message: "Hesap zaten kapali." });
        }

        const { data: detaylar, error: detayErr } = await supabase
            .from('siparis_detaylari')
            .select('urun_id, adet, urunler(id, ad, stok_takibi, stok_miktar)')
            .eq('siparis_id', siparisId);

        if (detayErr) throw detayErr;

        const { error } = await supabase
            .from('siparisler')
            .update({ durum: 'kapalÄ±' })
            .eq('id', siparisId);

        if (error) throw error;

        const { error: gelirErr } = await supabase
            .from('giderler')
            .insert([{
                dukkan_id: siparis.dukkan_id,
                baslik: `Siparis #${siparis.id} odemesi`,
                kategori: 'Gelir',
                tutar: Number(siparis.toplam_tutar || 0)
            }]);
        if (gelirErr) throw gelirErr;

        for (const detay of (detaylar || [])) {
            const urun = detay.urunler;
            if (!urun?.stok_takibi) continue;

            const dusulecek = Number(detay.adet || 0);
            const yeniMiktar = Math.max(0, Number(urun.stok_miktar || 0) - dusulecek);

            const { error: stokErr } = await supabase
                .from('urunler')
                .update({ stok_miktar: yeniMiktar })
                .eq('id', detay.urun_id);
            if (stokErr) throw stokErr;

            const { error: hareketErr } = await supabase
                .from('stok_hareketleri')
                .insert([{ dukkan_id: siparis.dukkan_id, urun_id: detay.urun_id, miktar: dusulecek, islem_turu: 'cikis' }]);
            if (hareketErr) throw hareketErr;
        }
        return res.json({ success: true, message: "Hesap kapatildi, masa bosaltildi." });
    } catch (error) {
        res.status(500).json({ error: "Sunucu hatasÄ±" });
    }
});
app.listen(PORT, () => console.log(`ğŸš€ Esnoloji Aktif: http://localhost:${PORT}`));







