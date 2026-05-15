# DEVLOG

## 2026-05-15

- Estado de conversación persistente sólo dentro del proceso Node mediante `conversationMemory` (`Map`): adecuado para pruebas; en serverless el estado puede perderse al escalar o al reinicio.
- Se retiró Supabase del código y dependencias; leads confirmados se registran vía `console.log` hasta definir BD.
- Previo Next + Express coexistencia y luego Supabase fueron pasos intermedios; el repo queda sólo Next con memoria RAM.
