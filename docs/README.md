# Documentação do Poup

O que está aqui, e quando ler cada coisa.

| Documento | O que é |
| --- | --- |
| [PLAN.md](PLAN.md) | O plano vivo. Descreve o que **existe** hoje e o que está no backlog. É o primeiro a ler, e o que se atualiza quando algo passa a existir. |
| [REVISAO-PROJETO.md](REVISAO-PROJETO.md) | Revisão de 19/08/2026: o que o código realmente fazia contra o que o plano dizia. A regra escrita no topo do `PLAN.md` nasceu daqui. |
| [DESIGN-CORRECTIONS.md](DESIGN-CORRECTIONS.md) | Notas de design acumuladas — decisões visuais e as correções que as motivaram. |
| [historico/](historico/) | Planos de fases já concluídas. Ficam para explicar por que as coisas são como são, não para serem executados de novo. |
| [superpowers/](superpowers/) | Specs de design e planos de implementação, um par por feature. Gerados pelo fluxo de trabalho e nomeados por data. |

## Por que os planos não moram na raiz

A raiz de um repositório é onde se procura como rodar o projeto, não o que se
pretendia construir. Plano é documentação com data de validade: vale enquanto a
feature não existe, e depois vira histórico. Os dois estados vivem aqui.
