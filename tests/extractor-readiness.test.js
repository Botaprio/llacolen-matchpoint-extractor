'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MatchPointExtractor } = require('../src/services/extractor');

test('reutiliza el Cuadro de Reservas ya abierto entre dos extracciones consecutivas', async () => {
  let iconClicks = 0;
  let idleChecks = 0;

  const boardSelector = {
    isVisible: async () => true
  };
  const frame = {
    locator: (selector) => {
      assert.equal(selector, 'select[name="ctl01$CC$DropDownListCuadros"]');
      return boardSelector;
    }
  };
  const icon = {
    waitFor: async () => {},
    click: async () => { iconClicks += 1; }
  };
  const page = {
    frameLocator: (selector) => {
      assert.equal(selector, '#iframeContenido');
      return frame;
    },
    locator: (selector) => {
      assert.equal(selector, '#imgCuadroReservas');
      return icon;
    },
    waitForTimeout: async () => {}
  };

  const extractor = new MatchPointExtractor({
    browserSession: {},
    database: {},
    onProgress: () => {}
  });
  extractor.waitForBoardIdle = async () => { idleChecks += 1; };

  await extractor.openReservationBoard(page);
  assert.equal(iconClicks, 0, 'no debe volver a pulsar el icono si el tablero ya está abierto');
  assert.equal(idleChecks, 1, 'debe verificar brevemente que el tablero esté estable');
});
