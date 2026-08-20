# Logos de instituições financeiras

Solte aqui os logos dos bancos. Eles são detectados automaticamente em build —
nenhum registro ou import manual é necessário.

## O que vem da API

O logo **já vem da Pluggy**: o conector expõe `imageUrl` e `primaryColor`, que o
`sync` grava em `Item.institutionImageUrl` / `Item.institutionColor` e a API
devolve em `AccountDTO` e `ItemDTO`. Ou seja, contas conectadas via Open Finance
mostram o logo sem que você forneça nada.

Esta pasta existe para os casos em que a imagem da Pluggy não serve: conector
sem logo, arte de baixa qualidade, ou quando você quer padronizar a marca.

## Ordem de precedência

1. **Imagem enviada pelo app** (`Item.customImageUrl`), pelo botão de editar
   sobre o logo da instituição no Perfil. O `sync` não a sobrescreve.
2. **Arquivo local** desta pasta.
3. **`Item.institutionImageUrl`**, vinda do conector da Pluggy.
4. Nada: o app desenha o ícone genérico de banco.

## Nomeação

O nome do arquivo é o slug do nome da instituição como ele aparece no app:
minúsculas, sem acento, espaços viram hífen.

| Instituição no app        | Arquivo                        |
| ------------------------- | ------------------------------ |
| Banco Inter               | `banco-inter.svg`              |
| Caixa Econômica Federal   | `caixa-economica-federal.svg`  |
| Nubank                    | `nubank.svg`                   |
| Itaú                      | `itau.svg`                     |
| C6 Bank                   | `c6-bank.svg`                  |
| XP Investimentos          | `xp-investimentos.svg`         |

## Formato

- Extensões aceitas: `.svg`, `.png`, `.webp`, `.jpg`.
- **SVG é o preferido** — escala sem serrilhar em telas HiDPI.
- Use o símbolo/monograma quadrado da marca, não o logotipo horizontal com o
  nome: ele é renderizado dentro de um quadrado de 32–40px.
- Deixe o fundo transparente. O app desenha o fundo usando a cor da marca
  (`institutionColor`) ou a superfície neutra do tema.
- Sem margem interna: o recorte deve encostar nas bordas do viewBox.

O resolvedor vive em [`src/lib/institutions.ts`](../../lib/institutions.ts).
