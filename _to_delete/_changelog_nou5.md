## 26 august 2026 (2) — Mesajele ajung în timp real (Supabase Realtime, canal „broadcast" per conversație)

Raportat de Radu: mesajele apăreau cu câteva secunde întârziere sau abia după refresh. Cauza: mesageria mergea exclusiv pe interogare periodică — firul deschis la 20 s, lista de conversații la 60 s. În cel mai rău caz, un mesaj se vedea după 20 de secunde.

### Ce s-a schimbat
Fiecare conversație are acum un canal **Supabase Realtime** de tip *broadcast*, `mesagerie:<threadId>`. Clientul se abonează la canalele tuturor conversațiilor lui (maximum 24). Cine trimite un mesaj dă, după salvare, un semnal pe canalul firului; ceilalți îl primesc în milisecunde și:

- dacă au **firul deschis** → reîncarcă mesajele;
- dacă au **altă conversație deschisă sau niciuna** → reîncarcă doar lista, ca să crească bulina de necitite.

Semnalele sosite în rafală (mai multe mesaje la rând) sunt comasate printr-un debounce de 250 ms — o singură reîncărcare, nu una per mesaj.

### De ce broadcast și nu `postgres_changes`
`postgres_changes` ar fi cerut politici RLS de **citire** pe `chat_messages` pentru browser, adică deschiderea tabelului către client — cu tot ce înseamnă asta: apartenența la grupă se verifică prin `mentor_groups` + `mentor_students`, deci politica ar fi fost complicată, iar o greșeală în ea = scurgere de mesaje între grupe.

Broadcast-ul nu atinge deloc baza: semnalul conține **doar id-ul conversației**, niciun pic de conținut. Cine ar asculta canalul ar afla cel mult că „în firul X s-a scris ceva" — iar ca să citească trebuie tot să treacă prin `/api/messages`, care verifică apartenența la grupă și legătura de colegi, ca până acum. **Modelul de securitate rămâne neschimbat, fără SQL nou.**

### Plasa de siguranță
Interogarea periodică nu a dispărut, doar s-a rărit — și se adaptează:

| | canal conectat | fără websocket |
|---|---|---|
| firul deschis | 25 s | 8 s |
| lista de conversații | 45 s | 20 s |

Starea canalului se citește din `subscribe((status) => …)`: `SUBSCRIBED` → ritm rar; `CHANNEL_ERROR` / `TIMED_OUT` → ritm des. Așa, o rețea care blochează websocket-urile (proxy de școală, extensii) înrăutățește experiența, dar nu o rupe — și devine chiar mai promptă decât înainte (8 s față de 20 s).

În plus, revenirea în tab sau pe fereastră (`focus` / `visibilitychange`) aduce imediat ce s-a scris între timp, în loc să aștepte următorul tic.

### Verificare
`Mesagerie.jsx` trece prin esbuild și prin ESLint — zero erori, zero avertismente. Fără modificări de API sau SQL: **doar deploy**. Realtime e pornit implicit pe proiectele Supabase, iar canalele publice de tip broadcast nu cer politici suplimentare.

---
