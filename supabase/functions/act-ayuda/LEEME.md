# 🤖 Ayuda: cómo prenderla en el servidor

La Ayuda funciona con Claude, la IA de Anthropic. Hay que hacer 4 cosas una sola vez. Las hace Jose; la llave nunca se pega en un chat.

## 1. La cuenta y la llave de Anthropic
1. Entra a https://platform.claude.com, crea la cuenta (puede ser con el correo de la compañía) y en **Billing** pon saldo (por ejemplo US$20 para empezar). Ahí mismo puedes poner un **límite de gasto por mes**.
2. En **API Keys** › **Create Key**, ponle de nombre `ops-summary-ayuda` y copia la llave (empieza con `sk-ant-`). Solo se ve una vez.

## 2. La llave en Supabase (nunca en la app)
1. Supabase › tu proyecto › **Edge Functions** › **Secrets** (o Project Settings › Edge Functions).
2. **Add new secret**: nombre `ANTHROPIC_API_KEY`, valor = la llave. Guardar.
3. Opcionales (si no los pones, se usan estos):
   - `AYUDA_MODEL` = `claude-opus-5-5` (el más exacto). Para gastar menos: `claude-haiku-5-5`.
   - `AYUDA_EFFORT` = `low`
   - `AYUDA_DAILY` = `60` (preguntas por persona en 24 horas; el dueño no tiene límite)

## 3. La tabla de las preguntas (SQL 029)
Supabase › **SQL Editor** › pega todo `supabase/migrations/029_ayuda.sql` › **Run**. Debe decir "029: table act_ayuda in place".

## 4. La función
Supabase › **Edge Functions** › **Deploy a new function** › **Via Editor**:
1. Nombre: `act-ayuda`.
2. Archivo `index.ts`: pega `supabase/functions/act-ayuda/index.ts`.
3. Agrega un archivo `core.ts` y pega `supabase/functions/act-ayuda/core.ts` (lleva la guía adentro).
4. **Deploy**.

(Con la Supabase CLI es una línea: `supabase functions deploy act-ayuda`.)

## Después
- Mientras está apagada en **Ajustes › 🧪 Pestañas nuevas › 🤖 Ayuda con IA**, solo la usa el dueño: pruébala tú primero.
- Prendida, la usan todos, cada quien con lo de su rol.
- Lo que preguntan, las respuestas y los 👍/👎 quedan en la tabla `act_ayuda` (Supabase › Table Editor). Solo la lee el dueño.
- Cuando cambie una pantalla o un número de la app, se actualiza la guía (`tools/ayuda/kb/*.md`), se corre `node tools/ayuda/build-kb.mjs` y se vuelve a subir `core.ts` a la función.

## Cuánto cuesta (aproximado)
La guía de cada rol mide unos 17 mil tokens y queda en caché entre preguntas.
- Opus 5.5: unos US$0.02–0.04 por pregunta (con foto, un poco más).
- Haiku 5.5: menos de US$0.005 por pregunta.
