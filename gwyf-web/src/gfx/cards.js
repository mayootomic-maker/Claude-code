/* Playing cards: real geometry, one shared texture.

   All 52 faces plus the back are drawn into a single atlas and every card uses
   the same material with different UVs. A texture per card is the obvious way
   and it costs 53 draw calls and 53 uploads for a table that shows six cards. */

(function (global) {
  'use strict';

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = [
    { id: 's', glyph: '♠', red: false, name: 'spades' },
    { id: 'h', glyph: '♥', red: true, name: 'hearts' },
    { id: 'd', glyph: '♦', red: true, name: 'diamonds' },
    { id: 'c', glyph: '♣', red: false, name: 'clubs' },
  ];

  const CW = 200, CH = 280;        // one cell of the atlas, in pixels
  const COLS = 13, ROWS = 5;       // four suits, then a row for the back
  const CARD_W = 0.62, CARD_H = 0.88, CARD_D = 0.012;

  const INK = '#17110f';
  const RED = '#b5202f';
  const FACE = '#f4efe6';

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawFace(g, x, y, rank, suit) {
    const pad = 7;
    g.save();
    g.translate(x, y);
    roundRect(g, pad, pad, CW - pad * 2, CH - pad * 2, 14);
    g.fillStyle = FACE;
    g.fill();
    g.strokeStyle = 'rgba(23,17,15,0.22)';
    g.lineWidth = 2;
    g.stroke();

    const colour = suit.red ? RED : INK;
    g.fillStyle = colour;
    g.textAlign = 'center';

    // Index corners, one upright and one rotated, exactly as a real card does
    // it -- which is the only reason a fanned hand is readable at all.
    for (const flip of [false, true]) {
      g.save();
      if (flip) { g.translate(CW, CH); g.rotate(Math.PI); }
      g.textBaseline = 'top';
      g.font = '700 42px ' + FONT;
      g.fillText(rank, 34, 18);
      g.font = '34px ' + FONT;
      g.fillText(suit.glyph, 34, 62);
      g.restore();
    }

    g.textBaseline = 'middle';
    if (rank === 'J' || rank === 'Q' || rank === 'K') {
      // A court card without a portrait: a monogram in a frame. Drawing a real
      // one at this size turns to mud, and a muddy king is worse than a clean
      // letter.
      g.save();
      g.strokeStyle = colour;
      g.lineWidth = 3;
      roundRect(g, 46, 62, CW - 92, CH - 124, 8);
      g.stroke();
      g.globalAlpha = 0.10;
      g.fillRect(46, 62, CW - 92, CH - 124);
      g.globalAlpha = 1;
      g.font = '700 88px ' + FONT;
      g.fillText(rank, CW / 2, CH / 2 - 12);
      g.font = '30px ' + FONT;
      g.fillText(suit.glyph, CW / 2, CH / 2 + 52);
      g.restore();
    } else {
      const n = rank === 'A' ? 1 : Number(rank);
      if (n === 1) {
        g.font = '104px ' + FONT;
        g.fillText(suit.glyph, CW / 2, CH / 2);
      } else {
        const cols = n <= 3 ? 1 : 2;
        const per = Math.ceil(n / cols);
        g.font = '40px ' + FONT;
        for (let i = 0; i < n; i++) {
          const c = cols === 1 ? 0 : Math.floor(i / per);
          const r = cols === 1 ? i : i % per;
          const px = cols === 1 ? CW / 2 : (c === 0 ? CW * 0.34 : CW * 0.66);
          const py = 78 + (CH - 156) * (per === 1 ? 0.5 : r / (per - 1));
          g.save();
          g.translate(px, py);
          if (py > CH / 2) g.rotate(Math.PI);
          g.fillText(suit.glyph, 0, 0);
          g.restore();
        }
      }
    }
    g.restore();
  }

  function drawBack(g, x, y) {
    const pad = 7;
    g.save();
    g.translate(x, y);
    roundRect(g, pad, pad, CW - pad * 2, CH - pad * 2, 14);
    g.fillStyle = '#5c1620';
    g.fill();
    g.save();
    g.clip();
    // A woven lattice, drawn rather than tiled, so the back has the same
    // resolution as the faces and does not shimmer when a card turns.
    g.strokeStyle = 'rgba(233,180,76,0.5)';
    g.lineWidth = 1.6;
    for (let i = -CH; i < CW + CH; i += 13) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CH, CH); g.stroke();
      g.beginPath(); g.moveTo(i + CH, 0); g.lineTo(i, CH); g.stroke();
    }
    g.restore();
    roundRect(g, 20, 20, CW - 40, CH - 40, 9);
    g.strokeStyle = '#e9b44c';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#e9b44c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '64px ' + FONT;
    g.fillText('♠', CW / 2, CH / 2);
    g.restore();
  }

  let FONT = "'Inter', system-ui, sans-serif";
  let atlas = null;

  function buildAtlas() {
    if (atlas) return atlas;
    const canvas = global.document.createElement('canvas');
    canvas.width = COLS * CW;
    canvas.height = ROWS * CH;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let s = 0; s < SUITS.length; s++) {
      for (let r = 0; r < RANKS.length; r++) {
        drawFace(g, r * CW, s * CH, RANKS[r], SUITS[s]);
      }
    }
    drawBack(g, 0, 4 * CH);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    atlas = { canvas, tex };
    return atlas;
  }

  /* Extrude a rounded rectangle and map the caps to one atlas cell. The default
     extrude UVs run in world units, which puts a different slice of the atlas on
     every card unless they are replaced. */
  function cardGeometry(col, row) {
    const w = CARD_W, h = CARD_H, r = 0.055;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_D, bevelEnabled: false, curveSegments: 6,
    });
    geo.translate(0, 0, -CARD_D / 2);
    geo.computeVertexNormals();

    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    const du = 1 / COLS, dv = 1 / ROWS;
    const backU = 0 * du, backV = 1 - (4 + 1) * dv;
    const faceU = col * du, faceV = 1 - (row + 1) * dv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), nz = nor.getZ(i);
      const fx = (x + w / 2) / w, fy = (y + h / 2) / h;
      if (nz > 0.5) {                       // front
        uv[i * 2] = faceU + fx * du;
        uv[i * 2 + 1] = faceV + fy * dv;
      } else if (nz < -0.5) {               // back, mirrored so it is not reversed
        uv[i * 2] = backU + (1 - fx) * du;
        uv[i * 2 + 1] = backV + fy * dv;
      } else {                              // the edge: a sliver of white card
        uv[i * 2] = backU + du * 0.5;
        uv[i * 2 + 1] = backV + dv * 0.02;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }

  let material = null;
  function cardMaterial() {
    if (material) return material;
    material = new THREE.MeshPhysicalMaterial({
      map: buildAtlas().tex,
      roughness: 0.42,
      clearcoat: 0.5,
      clearcoatRoughness: 0.28,
      metalness: 0,
    });
    return material;
  }

  /* A card. Face down means rotated 180 degrees about Y, not a texture swap,
     so turning one over is a real rotation with a real edge in the middle. */
  function card(rank, suit) {
    const r = RANKS.indexOf(rank);
    const s = SUITS.findIndex((x) => x.id === suit);
    const mesh = new THREE.Mesh(cardGeometry(r, s), cardMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.card = { rank, suit, r, s };
    return mesh;
  }

  function deck() {
    const out = [];
    for (const s of SUITS) for (const r of RANKS) out.push({ rank: r, suit: s.id });
    return out;
  }

  /* Blackjack values. Aces are eleven until the hand busts, then one. */
  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.rank === 'A') { aces++; total += 11; }
      else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') total += 10;
      else total += Number(c.rank);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 && total <= 21 };
  }

  const rankValue = (rank) => RANKS.indexOf(rank) + 1;   // ace low, for high-low

  global.GWCards = {
    RANKS, SUITS, card, deck, handValue, rankValue, buildAtlas,
    CARD_W, CARD_H, CARD_D,
    setFont(f) { FONT = f; atlas = null; material = null; },
  };
})(window);
