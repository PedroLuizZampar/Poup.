#!/usr/bin/env node
/**
 * Portão de contraste dos tokens de cor.
 *
 * Lê os tokens direto de `src/index.css` — nunca de uma cópia — porque um
 * verificador que guarda os próprios valores para de verificar no dia em que
 * alguém edita o CSS e esquece dele.
 *
 * Roda nos dois temas. O escuro é o controle: ele não deveria mudar, então uma
 * reprovação de contraste lá é sinal de que uma edição vazou do `:root` para o
 * `.dark`.
 *
 * O escuro carrega uma lista curta de desvios conhecidos, em CONHECIDAS_ESCURO.
 * Todos são anteriores a este passe e nenhum é efeito dele. Eles saem como
 * aviso, impressos a cada rodada, em vez de reprovarem — mas qualquer desvio
 * que **não** esteja nessa lista reprova, que é justamente o que faz o escuro
 * servir de controle contra contaminação vinda do `:root`.
 *
 *   node apps/web/scripts/verificar-contraste.mjs [--verbose]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const CSS = join(RAIZ, "src", "index.css");

/**
 * Três arquivos precisam repetir `--bg` de cada tema à mão, porque nenhum deles
 * consegue ler CSS: a meta `theme-color` do HTML, que pinta a barra do
 * navegador antes de o JS subir; o mapa do ThemeContext, que reescreve essa
 * meta depois; e o manifest do PWA, que dá a cor da splash. Divergir de `--bg`
 * dá uma faixa de cor errada acima do conteúdo ou um pisca na abertura — e o
 * defeito não aparece em nenhum teste. Já aconteceu uma vez, no passe que
 * baixou o fundo do tema claro.
 */
const ESPELHOS_DO_BG = [
  { arquivo: "index.html", temas: ["claro", "escuro"] },
  { arquivo: "src/context/ThemeContext.tsx", temas: ["claro", "escuro"] },
  // O manifest do PWA tem uma cor de splash só: não existe versão escura dele.
  { arquivo: "vite.config.ts", temas: ["claro"] },
];

/* ---------- leitura dos tokens ---------- */

/** Recorta o corpo do primeiro bloco `seletor { ... }`, contando chaves. */
function corpoDoBloco(css, seletor) {
  const inicio = css.indexOf(seletor);
  if (inicio === -1) throw new Error(`bloco "${seletor}" não encontrado em index.css`);
  const abre = css.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < css.length; i++) {
    if (css[i] === "{") nivel++;
    else if (css[i] === "}" && --nivel === 0) return css.slice(abre + 1, i);
  }
  throw new Error(`bloco "${seletor}" não fecha`);
}

function tokensDoBloco(corpo) {
  const mapa = {};
  for (const [, nome, valor] of corpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    mapa[nome] = valor.trim();
  }
  return mapa;
}

/* ---------- cor ---------- */

function parseCor(valor) {
  const v = String(valor).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const [a, b, c] = m[1];
    return [parseInt(a + a, 16), parseInt(b + b, 16), parseInt(c + c, 16), 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`cor não reconhecida: "${v}"`);
}

/**
 * Achata uma cor com alpha sobre um fundo opaco. Os `-soft` e os fundos de
 * categoria do tema escuro são véus: medir contraste sem achatar dá um número
 * que ninguém vê na tela.
 */
function sobre(cor, fundo) {
  const [r, g, b, a] = cor;
  if (a >= 1) return [r, g, b, 1];
  return [
    r * a + fundo[0] * (1 - a),
    g * a + fundo[1] * (1 - a),
    b * a + fundo[2] * (1 - a),
    1,
  ];
}

const linear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminancia = ([r, g, b]) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** CIELAB, D65, observador 2°. */
function lab([r, g, b]) {
  const [x, y, z] = [
    linear(r) * 0.4124 + linear(g) * 0.3576 + linear(b) * 0.1805,
    linear(r) * 0.2126 + linear(g) * 0.7152 + linear(b) * 0.0722,
    linear(r) * 0.0193 + linear(g) * 0.1192 + linear(b) * 0.9505,
  ];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x / 0.95047), f(y / 1.0), f(z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const lightness = (cor) => lab(cor)[0];

/** ΔE CIE76 — distância euclidiana em Lab. */
function deltaE(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/* ---------- portão ---------- */

const SUPERFICIES = ["--surface", "--surface-alt", "--bg", "--surface-sunken"];
// `--info` entra aqui mesmo sem `-soft`: o portão pergunta pelo par que existe.
const SEMANTICAS = ["--income", "--expense", "--warning", "--error", "--info"];

/**
 * Piso do texto primário. Não é 7:1 (o AAA) nem 10:1: é o valor logo abaixo do
 * pior caso do desenho atual — o primário sobre `--surface-sunken`, a 9,65:1.
 * O portão aqui não existe para exigir mais contraste, e sim para impedir que
 * uma varredura futura "conserte" o texto de volta para 16:1 sobre branco puro,
 * que foi exatamente o que cansava a vista.
 */
const PISO_TEXTO_PRIMARIO = 9.5;

const razao = (v) => `${v.toFixed(2)}:1`;
const emDE = (v) => `ΔE ${v.toFixed(1)}`;

function verificar(tema, tokens, { verbose, escada, conhecidas = [] }) {
  const falhas = [];
  const avisos = [];
  const conhecida = (rotulo) => conhecidas.some((prefixo) => rotulo.startsWith(prefixo));
  const cor = (nome) => parseCor(tokens[nome]);
  const card = cor("--surface");
  const superficie = (nome) => sobre(cor(nome), card);

  const registrar = (rotulo, texto) =>
    (conhecida(rotulo) ? avisos : falhas).push(`[${tema}] ${rotulo} — ${texto}`);

  const checar = (rotulo, valor, minimo, formato = razao) => {
    const ok = valor >= minimo;
    if (!ok) registrar(rotulo, `${formato(valor)}, mínimo ${formato(minimo)}`);
    if (verbose || !ok) {
      const marca = ok ? "ok   " : conhecida(rotulo) ? "aviso" : "FALHA";
      console.log(`   ${marca} ${rotulo.padEnd(46)} ${formato(valor)}`);
    }
  };

  console.log(`\n── tema ${tema} ──`);

  console.log(" texto");
  for (const s of SUPERFICIES) {
    checar(`--text-primary sobre ${s}`, contraste(cor("--text-primary"), superficie(s)), PISO_TEXTO_PRIMARIO);
  }
  for (const s of SUPERFICIES) {
    checar(`--text-secondary sobre ${s}`, contraste(cor("--text-secondary"), superficie(s)), 4.5);
  }

  console.log(" marca");
  checar(
    "--on-primary sobre --primary",
    contraste(cor("--on-primary"), sobre(cor("--primary"), card)),
    4.5,
  );
  checar("--primary sobre --surface", contraste(cor("--primary"), card), 4.5);
  // O véu da marca leva `text-primary` por cima em UserAvatar, UpdateBanner e
  // no cartão de credenciais do perfil — então ele é par de leitura, não só
  // decoração.
  checar(
    "--primary sobre --primary-soft",
    contraste(cor("--primary"), sobre(cor("--primary-soft"), card)),
    4.5,
  );

  console.log(" semânticas");
  for (const nome of SEMANTICAS) {
    const tinta = cor(nome);
    checar(`${nome} sobre --surface`, contraste(tinta, card), 4.5);
    const veu = tokens[`${nome}-soft`];
    if (veu) checar(`${nome} sobre ${nome}-soft`, contraste(tinta, sobre(parseCor(veu), card)), 4.5);
  }

  console.log(" categorias");
  const fgs = [];
  for (let n = 1; n <= 16; n++) {
    const fg = cor(`--cat-${n}-fg`);
    fgs.push([n, fg]);
    checar(`--cat-${n}-fg sobre --cat-${n}-bg`, contraste(fg, sobre(cor(`--cat-${n}-bg`), card)), 4.5);
  }
  let pior = { d: Infinity, par: "" };
  for (let i = 0; i < fgs.length; i++) {
    for (let j = i + 1; j < fgs.length; j++) {
      const d = deltaE(fgs[i][1], fgs[j][1]);
      if (d < pior.d) pior = { d, par: `cat-${fgs[i][0]} × cat-${fgs[j][0]}` };
    }
  }
  checar(`menor ΔE entre foregrounds (${pior.par})`, pior.d, 10, emDE);

  console.log(" elevação");
  for (let i = 0; i < escada.length - 1; i++) {
    const [nomeA, nomeB] = [escada[i], escada[i + 1]];
    const passo = lightness(superficie(nomeA)) - lightness(superficie(nomeB));
    const rotulo = `degrau ${nomeA} → ${nomeB}`;
    const ok = passo >= 2 && passo <= 5;
    if (!ok) {
      registrar(
        rotulo,
        `ΔL* ${passo.toFixed(2)}, fora da faixa 2,0–5,0. Abaixo de 2 as duas superfícies viram a mesma cor; acima de 5 o degrau vira emenda visível; negativo é escada invertida.`,
      );
    }
    if (verbose || !ok) {
      const marca = ok ? "ok   " : conhecida(rotulo) ? "aviso" : "FALHA";
      console.log(`   ${marca} ${rotulo.padEnd(46)} ΔL* ${passo.toFixed(2)}`);
    }
  }

  return { falhas, avisos };
}

/* ---------- execução ---------- */

const verbose = process.argv.includes("--verbose");
const css = readFileSync(CSS, "utf8");
const claro = tokensDoBloco(corpoDoBloco(css, ":root"));
const escuro = { ...claro, ...tokensDoBloco(corpoDoBloco(css, ".dark")) };

/**
 * Desvios que o tema escuro já tinha antes do passe do modo claro. Nenhum foi
 * causado por ele e nenhum entra no escopo dele — mas todos são reais, então
 * ficam listados e impressos em vez de removidos do portão.
 *
 *  · Vermelho e Carmim são quase o mesmo traço no escuro (#FCA5A5 x #FDA4AF).
 *    No claro os dois se separam; aqui não. Custa distinguibilidade numa lista
 *    longa de categorias.
 *  · `--surface-sunken` e `--bg` estão a ΔL* 1,5 um do outro: no escuro o fundo
 *    da página já é o piso, e o afundado não tem para onde descer.
 *  · O verde da marca sobre o próprio véu fica a 4,22:1 — perto, mas abaixo do
 *    mínimo de texto.
 */
const CONHECIDAS_ESCURO = [
  "menor ΔE entre foregrounds",
  "degrau --surface-sunken → --bg",
  "--primary sobre --primary-soft",
];

const resultados = [
  verificar("claro", claro, {
    verbose,
    // No claro, elevar é clarear: o cartão é o topo e o afundado é o piso.
    escada: ["--surface", "--surface-alt", "--bg", "--surface-sunken"],
  }),
  verificar("escuro (controle)", escuro, {
    verbose,
    // No escuro a ordem se inverte, e o fundo da página é o piso da escala.
    escada: ["--surface-alt", "--surface", "--surface-sunken", "--bg"],
    conhecidas: CONHECIDAS_ESCURO,
  }),
];

const falhas = resultados.flatMap((r) => r.falhas);
const avisos = resultados.flatMap((r) => r.avisos);

/* ---------- espelhos de --bg fora do CSS ---------- */

const bgDoTema = { claro: claro["--bg"], escuro: escuro["--bg"] };
for (const { arquivo, temas } of ESPELHOS_DO_BG) {
  const texto = readFileSync(join(RAIZ, arquivo), "utf8").toUpperCase();
  for (const tema of temas) {
    const cor = bgDoTema[tema].toUpperCase();
    if (!texto.includes(cor)) {
      falhas.push(
        `[espelho] ${arquivo} não menciona ${cor}, o --bg do tema ${tema}. ` +
          `Esse arquivo repete a cor à mão para pintar a barra do navegador ou a ` +
          `splash, e divergir de --bg dá faixa de cor errada acima do conteúdo.`,
      );
    }
  }
}

console.log("");
if (avisos.length) {
  console.log(`⚠ ${avisos.length} desvio(s) conhecido(s) do tema escuro, anteriores a este passe:`);
  for (const a of avisos) console.log(`  · ${a}`);
  console.log("");
}
if (falhas.length) {
  console.error(`✗ ${falhas.length} reprovação(ões):`);
  for (const f of falhas) console.error(`  · ${f}`);
  process.exit(1);
}
console.log("✓ todos os portões bloqueantes passaram.");
