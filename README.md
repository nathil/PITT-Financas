# PITT Finanças — Chatbot WhatsApp de Organização Financeira (MVP)

<img width="1126" height="564" alt="Frame 18 (2)" src="https://github.com/user-attachments/assets/fecf4c6a-53bc-473e-be6b-94b983e87e66" />

Chatbot de WhatsApp construído em **Node.js + TypeScript**, com banco **SQLite + Prisma**, geração de planilhas **Excel (`.xlsx`)** via `ExcelJS` e geração de **Tabelas e Dashboards Executivos (`.png`)** via `Playwright + Chart.js`.

Inclui **controle de acesso exclusivo para usuários Testers** por número de telefone (`STRICT_TESTER_ONLY=true`), ignorando silenciosamente mensagens vindas de números não autorizados.

---

## 🔒 Como Configurar os Números dos Testers

Edite o arquivo [`.env`](file:///home/nathielly/Dev/PITT-AI/.env) na raiz do projeto:

```env
STRICT_TESTER_ONLY="true"
TESTER_PHONES="5511999999999,5521988888888"
```

- Você pode informar os números com DDI `55` + DDD + número (com ou sem o 9º dígito; o sistema normaliza ambos os formatos automaticamente).
- Mensagens de qualquer número fora dessa lista (ou vindas de grupos) são **ignoradas silenciosamente**.
- Também é possível adicionar ou remover testers em tempo de execução via API REST:
  - `GET /admin/testers` (Header `x-admin-key: pitt-admin-secret`)
  - `POST /admin/testers` com body `{ "phone": "5511999999999", "name": "Nome do Tester" }`
  - `DELETE /admin/testers/5511999999999`

---

## 🚀 Como Executar

Caso o Node.js global não esteja no `PATH`, use o runtime local incluído em `.runtime/node/bin`:

```bash
export PATH="/home/nathielly/Dev/PITT-AI/.runtime/node/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="/home/nathielly/Dev/PITT-AI/.runtime/browsers"

# Modo desenvolvimento (exibe QR Code no terminal se WHATSAPP_PROVIDER="baileys")
npm run dev

# Executar testes automatizados
npm test
```

---

## 💬 Funcionalidades do Chatbot

1. **Adicionar Gastos**:
   - Categorias: *Alimentação, Transporte, Educação, Saúde e Bem-Estar, Streaming, Dívidas e Compromissos Financeiros, Lazer e Estilo de Vida, Outros*.
   - Suporte a gastos **à vista** ou **parcelados** (dividindo automaticamente nas tabelas dos próximos meses).
2. **Adicionar Despesas Fixas**:
   - Categorias: As 8 categorias acima + **Reserva de Emergência**.
   - **Adicionar Despesa Fixa** (recorrente ou parcelada) com cálculo do total mensal comprometido.
   - **Pagamento**: Credita o pagamento mensal das despesas fixas.
3. **Empréstimo**:
   - **Valor do Empréstimo** + **Nome de quem pegou emprestado** (à vista ou parcelado).
   - **Pagamento**: Informa o valor $X$ pago e o nome da pessoa, subtraindo automaticamente do saldo que foi emprestado.
4. **Gerar Tabela de Gastos (`.png` ou `.xlsx`)**:
   - Janelas de **30, 60 e 90 dias** (com os nomes dos meses no cabeçalho).
5. **Gerar Dashboard de Gastos (`.png`)**:
   - Janelas de **30, 60 e 90 dias** (com os nomes dos meses no cabeçalho).
   - KPIs (Saldo Atual, Renda Total, Despesas Totais, Contas a Receber e Contas a Pagar).
   - Gráficos (Comparativo Mensal Receitas vs. Despesas, Distribuição de Despesas por Categoria em Pizza/Rosca, Gráfico de Barras por Categoria e Detalhamento das 9 categorias).
6. **Renda, Saldo e Orçamento**:
   - Registro de Receitas (Salário, Renda Extra, Dividendos, etc.), atualização do Saldo Atual e definição de Orçamento Mensal por Categoria.
