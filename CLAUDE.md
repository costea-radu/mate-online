# Reguli pentru Claude în mate-online

## Supabase: GRANT obligatoriu pentru tabelele noi

Din 30 octombrie 2026, Supabase nu mai dă automat acces Data API (supabase-js, PostgREST, GraphQL) tabelelor noi din schema `public`.

Orice fișier SQL din `supabase/` care face `create table public.<tabela>` trebuie să conțină, **în același fișier**, imediat după crearea tabelei:

```sql
alter table public.<tabela> enable row level security;

-- doar dacă tabela trebuie citită de vizitatori fără cont:
grant select on public.<tabela> to anon;

grant select, insert, update, delete on public.<tabela> to authenticated;
grant select, insert, update, delete on public.<tabela> to service_role;
```

- Nu da `anon` acces decât dacă datele sunt publice; dacă nu e clar, întreabă.
- Grant-urile nu înlocuiesc politicile RLS: fiecare tabelă nouă are și politicile ei.
- Lipsa grant-ului dă eroarea „permission denied for table …” în API.
