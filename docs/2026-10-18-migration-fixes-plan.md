# Correções de autenticação e sincronização final

Objetivo: preservar senhas bcrypt/Supabase e WordPress, encerrar o fallback após redefinição/troca de senha e permitir atualização final integral dos dados antes do cutover.

## Decisões

- Manter bcrypt como formato canônico. Verificar `$wp` oficial primeiro e o preparo customizado anterior como fallback, sem alterar hashes importados.
- Salvar senha e concluir a migração/vínculos pendentes em transação. Revalidar a elegibilidade do legado dentro da transação para impedir que um login concorrente restaure uma senha antiga.
- Manter o import inicial. Adicionar sincronização de snapshot completo com prévia por padrão, que mostra inclusões, alterações, exclusões e registros iguais, sem expor senhas/hashes.
- A sincronização recebe mirror e destino explicitamente. Staging temporário, snapshot consistente e somente leitura na origem, locks no destino durante aplicação e substituição transacional das 15 tabelas conhecidas. Esta carga integral resolve também exclusões e trocas de valores únicos, sem um delta incompleto baseado em timestamps. Aplicação exige manutenção nas duas aplicações, backup e confirmação explícita por flags CLI; não será executada em produção nesta tarefa.
- Validar igualdade de todo o conteúdo importado antes de commit. Falhas revertem dados e estado do trigger. Redefinir sequences das tabelas legadas. Invalidar sessões/cache Redis no procedimento operacional depois da carga final.

## Execução

1. Escrever testes independentes do formato `$wp` oficial e observar a falha; implementar verificação dupla e validar compatibilidade anterior.
2. Escrever testes E2E de reset/troca com legado não migrado e tentativa concorrente/stale; observar falhas; implementar persistência transacional e validar vínculos e rollback.
3. Escrever testes de sincronização em PostgreSQL isolado: prévia sem alterações, atualização literal de hash/flags, inclusões, exclusões, vínculos, idempotência e rollback; observar falhas; implementar CLI e sincronizador.
4. Atualizar o procedimento de importação e o relatório da auditoria, executar lint, typecheck, unitários, testes de importação, E2E e build da API; revisar o diff.

O snapshot é autoritativo para as 15 tabelas migradas. Dados exclusivos do destino são removidos apenas na aplicação explícita; a prévia exibe suas contagens. Depois do cutover, o sincronizador não deve ser usado sobre um destino que passou a receber dados reais.
