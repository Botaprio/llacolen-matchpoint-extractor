'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const LOGIN_URL = 'https://app-llacolencamposdeportivos.matchpoint.com.es/default.aspx';
const IFRAME_SELECTOR = '#iframeContenido';
const VIEW_SELECTOR = 'select[name="ctl01$CC$DropDownListCuadros"]';

function findEdgeExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ]
    : [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

// Candidate selectors tried in order when auto-filling the login form.
const LOGIN_USER_SELECTORS = [
  'input[name*="txtUsuario"]',
  'input[id*="txtUsuario"]',
  'input[name*="txtLogin"]',
  'input[id*="txtLogin"]',
  'input[name*="Usuario"]',
  'input[name*="Login"]',
  'input[name*="User"]',
  'input[type="text"]',
];
const LOGIN_SUBMIT_SELECTORS = [
  'input[type="submit"]',
  'button[type="submit"]',
  '#btnAcceder',
  '#btnLogin',
  'input[value*="Acceder"]',
  'input[value*="Entrar"]',
  'button:has-text("Acceder")',
  'button:has-text("Entrar")',
];

class BrowserSession {
  /**
   * @param {string} profileDirectory  Path to the Edge persistent profile.
   * @param {{ username: string, password: string } | null} credentials
   *   When provided, the session will attempt to fill and submit the login
   *   form automatically whenever the page is not yet authenticated.
   */
  constructor(profileDirectory, credentials = null) {
    this.profileDirectory = profileDirectory;
    this.credentials = credentials;
    this.context = null;
    this.page = null;
  }

  async open() {
    if (this.context && this.page && !this.page.isClosed()) {
      await this.page.bringToFront();
      return this.status();
    }

    const executablePath = findEdgeExecutable();
    if (!executablePath) {
      throw new Error('No se encontró Microsoft Edge. Instálalo o repáralo antes de continuar.');
    }

    this.context = await chromium.launchPersistentContext(this.profileDirectory, {
      executablePath,
      headless: false,
      viewport: null,
      acceptDownloads: true,
      args: ['--start-maximized', '--disable-features=msEdgeSidebarV2']
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.context.on('close', () => {
      this.context = null;
      this.page = null;
    });

    if (this.page.url() === 'about:blank') {
      await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } else {
      await this.page.bringToFront();
    }

    const { authenticated } = await this.status();
    if (!authenticated) {
      await this._tryAutoLogin(this.page);
    }

    return this.status();
  }

  /**
   * Detects the MatchPoint login form and fills it with the configured
   * credentials. Silently returns without throwing if anything goes wrong so
   * that `open()` always completes — the user can still log in manually.
   */
  async _tryAutoLogin(page) {
    if (!this.credentials) return;
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});

      // A visible password field is the reliable indicator of the login form.
      const pwField = page.locator('input[type="password"]').first();
      const hasLoginForm = await pwField.isVisible({ timeout: 4_000 }).catch(() => false);
      if (!hasLoginForm) return;

      // Fill username with the first matching visible field.
      let userFilled = false;
      for (const sel of LOGIN_USER_SELECTORS) {
        const field = page.locator(sel).first();
        if (await field.isVisible({ timeout: 500 }).catch(() => false)) {
          await field.fill(this.credentials.username);
          userFilled = true;
          break;
        }
      }
      if (!userFilled) return;

      await pwField.fill(this.credentials.password);

      // Submit with the first matching visible button.
      for (const sel of LOGIN_SUBMIT_SELECTORS) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click();
          break;
        }
      }

      // Wait for the authenticated indicator.
      await page.waitForSelector('#imgCuadroReservas', { state: 'visible', timeout: 20_000 }).catch(() => {});
    } catch {
      // Never propagate — open() must always succeed so the user can log in manually.
    }
  }

  async status() {
    if (!this.page || this.page.isClosed()) {
      return { open: false, authenticated: false, url: null };
    }

    // Durante los postbacks de MatchPoint el botón superior puede desaparecer
    // durante unos instantes aunque la sesión siga plenamente autenticada.
    // Consideramos también el Cuadro de Reservas ya abierto para no informar
    // falsos cierres de sesión entre una extracción mensual y la siguiente.
    const hasReservationIcon = await this.page.locator('#imgCuadroReservas').count().catch(() => 0) > 0;
    const hasOpenBoard = await this.page
      .frameLocator(IFRAME_SELECTOR)
      .locator(VIEW_SELECTOR)
      .count()
      .catch(() => 0) > 0;
    return { open: true, authenticated: hasReservationIcon || hasOpenBoard, url: this.page.url() };
  }

  async requireAuthenticatedPage() {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Abre el navegador e inicia sesión antes de extraer.');
    }

    // El final de una extracción puede coincidir con el último postback de
    // ASP.NET. Esperamos brevemente la estabilización de la página antes de
    // declarar que la sesión se perdió. Esto evita que el primer clic del mes
    // siguiente falle y el segundo, unos segundos después, sí funcione.
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const { authenticated } = await this.status();
      if (authenticated) return this.page;
      if (attempt < 6) await this.page.waitForTimeout(400).catch(() => {});
    }

    throw new Error('La sesión de MatchPoint no está iniciada. Inicia sesión en Edge y comprueba nuevamente.');
  }

  async createWorkerPage() {
    await this.requireAuthenticatedPage();
    const page = await this.context.newPage();
    try {
      // Pestaña independiente con la sesión que el usuario ya abrió en Edge.
      // No se manipulan cookies, credenciales ni endpoints privados.
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.locator('#imgCuadroReservas').waitFor({ state: 'visible', timeout: 15_000 });
      return page;
    } catch (error) {
      await page.close().catch(() => {});
      throw new Error(`No se pudo preparar una pestaña de extracción: ${String(error.message).slice(0, 240)}`);
    }
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }
}

module.exports = { BrowserSession, LOGIN_URL };
