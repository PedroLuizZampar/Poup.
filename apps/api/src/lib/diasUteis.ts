/**
 * O calendario que decide se uma data e dia util.
 *
 * Existe porque vencimento de fatura em sabado, domingo ou feriado nao e
 * cobrado naquele dia: o emissor posterga para o proximo dia util, e mostrar a
 * data crua faria o app discordar do banco em alguns dias por ano.
 *
 * Os feriados moveis saem calculados da Pascoa em vez de virem de uma tabela
 * por ano — uma tabela e uma divida com data marcada, e alguem teria de lembrar
 * de atualiza-la todo dezembro.
 */

/** Os fixos, como "MM-DD". Consciencia Negra e nacional desde a Lei 14.759/2023. */
const FIXOS = [
  "01-01", // Confraternizacao Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independencia
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamacao da Republica
  "11-20", // Consciencia Negra
  "12-25", // Natal
] as const;

/** "MM-DD" de uma data, em UTC. */
function chaveDoDia(data: Date): string {
  return `${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(
    data.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Domingo de Pascoa, pelo algoritmo de Meeus/Jones/Butcher. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** A mesma data deslocada em dias, em UTC. */
function maisDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

const cache = new Map<number, Set<string>>();

/**
 * Os feriados nacionais de um ano, como chaves "MM-DD".
 *
 * Memoizado por ano porque `proximoDiaUtil` consulta em laco, e o calculo da
 * Pascoa nao muda dentro do processo.
 */
export function feriadosNacionais(ano: number): Set<string> {
  const emCache = cache.get(ano);
  if (emCache) return emCache;

  const domingoDePascoa = pascoa(ano);
  const feriados = new Set<string>(FIXOS);
  // Carnaval e a terca, 47 dias antes; Sexta-Feira Santa, 2 dias antes;
  // Corpus Christi, 60 dias depois.
  feriados.add(chaveDoDia(maisDias(domingoDePascoa, -47)));
  feriados.add(chaveDoDia(maisDias(domingoDePascoa, -2)));
  feriados.add(chaveDoDia(maisDias(domingoDePascoa, 60)));

  cache.set(ano, feriados);
  return feriados;
}

export function ehDiaUtil(data: Date): boolean {
  const diaDaSemana = data.getUTCDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) return false;
  return !feriadosNacionais(data.getUTCFullYear()).has(chaveDoDia(data));
}

/**
 * A propria data, se ja for dia util; senao a proxima que for.
 *
 * O teto de dez voltas e uma trava contra laco infinito, nao um limite real: a
 * maior sequencia de dias nao uteis do calendario brasileiro tem quatro dias.
 */
export function proximoDiaUtil(data: Date): Date {
  let atual = data;
  for (let i = 0; i < 10 && !ehDiaUtil(atual); i++) {
    atual = maisDias(atual, 1);
  }
  return atual;
}
