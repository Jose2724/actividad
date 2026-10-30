import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWho } from './App'
import { tr } from './i18n'

/**
 * What each number means and how it is worked out (Jose, 2026-10-30: "que podamos ver un link para que nos explique la
 * matemática y qué significa cada resultado ... la app ha crecido mucho y a veces me preguntan qué quiere decir esto y
 * ya no me acuerdo"): one window for managers, the office and whoever only looks, opened from the header or from the
 * "¿Qué es esto?" beside a heading, which opens it on that number. The floor's operators do not see it. These words
 * say what the code does: when a number's arithmetic changes, this is the place to change too.
 */
export type NumberId = 'duracion' | 'trabajando' | 'parado' | 'setup' | 'causas' | 'donde' | 'codigos' | 'rato' | 'promedio'
  | 'hecho' | 'corrida' | 'waste' | 'turnos' | 'meta' | 'lenta' | 'carne' | 'consumo'
  | 'avance' | 'avance-estado' | 'lote-esperado' | 'lote-perdida' | 'lote-colores' | 'orden'
  | 'po-pallets' | 'po-completo' | 'vence' | 'pallet-unido' | 'hold'
  | 'peso-resumen' | 'peso-pruebas' | 'peso-bien' | 'peso-rinde' | 'peso-color' | 'asistencia'
  | 'kpi-horas' | 'kpi-prod' | 'kpi-costco' | 'kpi-mes'
type Group = 'tiempo' | 'prod' | 'avance' | 'lotes' | 'pedidos' | 'pesos' | 'gente' | 'kpi'
type Item = { id: NumberId; group: Group; title: string; means: string; math: string; eg?: string }

const groups = (): [Group, string][] => [['tiempo', tr('Tiempo y paros')], ['prod', tr('Producción')], ['avance', tr('Avance')], ['lotes', tr('Lotes')], ['pedidos', tr('Pedidos y pallets')], ['pesos', tr('Pesos')], ['gente', tr('Asistencia')], ['kpi', tr('KPI')]]

const items = (): Item[] => [
  { id: 'duracion', group: 'tiempo', title: tr('Duración del día o del turno'),
    means: tr('Cuánto duró el trabajo de un cuarto, como un reloj.'),
    math: tr('Desde que empezó el primer código hasta que terminó el último (o hasta ahora, si sigue corriendo). No se suman las líneas.'),
    eg: tr('Primer código a las 6:00 AM y último a las 2:30 PM = 8 h 30 min, aunque hayan sido 3 líneas.') },
  { id: 'trabajando', group: 'tiempo', title: tr('Trabajando'),
    means: tr('El tiempo que las líneas estuvieron con un código corriendo y sin parar.'),
    math: tr('Por cada línea: desde que empezó el código hasta que terminó, menos sus paros y su Set up. Luego se suman todas las líneas.'),
    eg: tr('3 líneas trabajando 5 horas cada una = 15 horas. Por eso puede ser más que la duración del día.') },
  { id: 'parado', group: 'tiempo', title: tr('Parado'),
    means: tr('El tiempo que las líneas estuvieron paradas mientras tenían un código.'),
    math: tr('La suma de los paros de todas las líneas, solo en el rato en que la línea tenía un código. El Set up no entra: va aparte.'),
    eg: tr('2 líneas paradas 1 hora a la misma hora = 2 horas de Parado.') },
  { id: 'setup', group: 'tiempo', title: tr('Set up'),
    means: tr('El tiempo preparando las líneas, entre un código y el siguiente.'),
    math: tr('La suma del Set up de todas las líneas. No cuenta como trabajando ni como parado. Si nadie está trabajando no cuenta: espera al siguiente código.') },
  { id: 'causas', group: 'tiempo', title: tr('Parado por causa'),
    means: tr('En qué se fue el tiempo de Parado: cada razón con su tiempo, la más grande primero. Sirve para ver qué fue lo que más paró a la planta.'),
    math: tr('Tiempo: se suman los paros de esa razón en todas las líneas. Porcentaje: el tiempo de esa razón ÷ el Parado total. Todas juntas dan 100%. Barra: se compara con la razón más grande, no con el total, por eso la primera siempre sale llena. No incluye Set up, solo cuenta mientras la línea tenía un código, y sigue los filtros de arriba (día, turno, cuarto, línea, código, lote).'),
    eg: tr('Parado total 4:31:23 y Problema mecánico 2:10:47. 2:10:47 ÷ 4:31:23 = 48%. Otra razón con 44:14 da 16% del total, y su barra llega a un 34%, porque 44:14 ÷ 2:10:47 = 34%.') },
  { id: 'donde', group: 'tiempo', title: tr('¿Dónde están los paros?'),
    means: tr('Cada cuarto con sus paros, y debajo cada línea con sus causas más largas.'),
    math: tr('Suma cada paro completo, tal como sale en Registros › Paros, tenga o no código la línea en ese momento. Por eso puede dar más que el Parado de las tarjetas, que solo cuenta mientras había un código. Tampoco incluye Set up.') },
  { id: 'codigos', group: 'tiempo', title: tr('Paros por código (Reason Codes)'),
    means: tr('Los paros con los códigos estándar de la planta, separados en planeados y no planeados.'),
    math: tr('Tiempo de cada código = el tiempo de sus paros. Veces = cuántos paros tuvo. % = su tiempo ÷ el total de esta tabla. Aquí el Set up sí entra (es PLN-03), por eso estos porcentajes no son iguales a los de Parado por causa.') },
  { id: 'rato', group: 'tiempo', title: tr('El rato entre un turno y otro'),
    means: tr('Cuándo ese rato cuenta y cuándo no.'),
    math: tr('El tiempo nunca se detiene solo. Si en una línea nadie registró nada en todo el rato entre un turno y otro, ese rato no cuenta ni como trabajado ni como parado. Si hubo un solo registro en ese rato, cuenta todo. Mientras está pasando, cuenta la primera hora por si la gente sigue ahí.') },
  { id: 'promedio', group: 'tiempo', title: tr('Promedio por unidad'),
    means: tr('Cuánto tarda en salir cada carro, mezcla o pallet de una corrida.'),
    math: tr('El tiempo trabajado entre una unidad y la siguiente, sin contar paros, y el promedio de esos tiempos. La primera se cuenta desde que empezó el código.') },

  { id: 'hecho', group: 'prod', title: tr('El número grande de cada cuarto'),
    means: tr('Lo que el cuarto produjo, en su propia palabra: mezclas, pouches, cajas, platos o copas.'),
    math: tr('La suma de lo registrado en lo que estás viendo. Debajo salen las unidades (carros, mezclas, pallets). MFO se cuenta tal como se escribe, sin pasarlo a cajas. Un pallet corto que otro terminó no cuenta como otro pallet, pero sus cajas sí cuentan.') },
  { id: 'corrida', group: 'prod', title: tr('Código y corrida'),
    means: tr('Un código es un producto. Una corrida es un código en una línea, desde que empieza hasta que termina.'),
    math: tr('Códigos = productos distintos. Corridas = cuántas veces se corrió un código en una línea.'),
    eg: tr('El 0889 en 2 líneas = 1 código y 2 corridas.') },
  { id: 'waste', group: 'prod', title: tr('Waste'),
    means: tr('Las libras de desperdicio que anotó la línea.'),
    math: tr('La suma de lo anotado. Si el código pasó de un turno al otro, se reparte según lo que hizo cada turno.') },
  { id: 'turnos', group: 'prod', title: tr('Cómo se reparte entre los turnos'),
    means: tr('A qué turno le toca cada cosa.'),
    math: tr('Cada registro cuenta en el turno de su hora. Un código que pasó de un turno al otro cuenta en los dos, cada uno con lo suyo.') },
  { id: 'meta', group: 'prod', title: tr('Meta del turno y ritmo'),
    means: tr('Cuánto lleva el turno contra lo que se le pidió. La pone el manager y solo cuenta lo de ese turno.'),
    math: tr('% = lo hecho en el turno ÷ la meta. Ritmo = lo hecho en el turno ÷ las horas desde su primer inicio. Si hay meta por hora, el ritmo se compara con ella. "Se llega a las" = lo que falta ÷ el ritmo, sumado a la hora de ahora.'),
    eg: tr('Meta 8,000 y van 4,000 en 4 horas: 50%, ritmo 1,000 por hora, faltan 4 horas.') },
  { id: 'lenta', group: 'prod', title: tr('Línea en rojo por ir lenta'),
    means: tr('Una señal de que la línea va por debajo del mínimo por hora del cuarto.'),
    math: tr('Mira lo hecho en la última hora de trabajo de la línea y lo compara con el mínimo de Ajustes › Ritmo mínimo. Empieza a juzgar después de la primera hora.') },
  { id: 'carne', group: 'prod', title: tr('Libras por mezcla (Carne de Spiral)'),
    means: tr('Cuánta carne se gastó por mezcla.'),
    math: tr('Las libras de carne anotadas ÷ las mezclas de ese código en lo que estás viendo.'),
    eg: tr('1,000 lb ÷ 20 mezclas = 50 lb por mezcla.') },
  { id: 'consumo', group: 'prod', title: tr('Consumo e inventario del cuarto'),
    means: tr('Lo que entró a un código y lo que sobró.'),
    math: tr('Son los pesos que la línea escribió antes de empezar y lo que dijo que quedó al terminar. Lo que quedó es el inventario del cuarto. La app no lo calcula: lo muestra como se escribió.') },

  { id: 'avance', group: 'avance', title: tr('Los números de Avance'),
    means: tr('Cada código con lo que debería salir de sus mezclas y lo que cada cuarto lleva.'),
    math: tr('Cajas esperadas = mezclas × cajas por mezcla (yield). Pouches esperados = cajas × pouches por caja. Pallets esperados = cajas ÷ cajas por pallet. "de N" usa las mezclas ya hechas. "faltan" = lo esperado − lo registrado; "de más" es lo registrado por encima. "programa · faltan" usa las mezclas programadas del día.'),
    eg: tr('10 mezclas × 18 cajas = 180 cajas esperadas. Si Packing lleva 150, faltan 30.') },
  { id: 'avance-estado', group: 'avance', title: tr('Estado de cada código en Avance'),
    means: tr('En qué va el código.'),
    math: tr('Sin empezar = nada registrado. En proceso = falta algo. Terminado = las mezclas del programa están hechas y lo que dan ya está empacado.') },

  { id: 'lote-esperado', group: 'lotes', title: tr('Esperado de un lote'),
    means: tr('Lo que cada cuarto debería recibir o hacer de ese lote.'),
    math: tr('Sale de lo que de verdad hizo el cuarto anterior, con la tabla de Productos. Mezclas × cajas por mezcla = cajas. Cajas × pouches por caja = pouches de RTE (o platos de MFO). Lo de RTE o MFO ÷ lo que lleva una caja = las cajas de Packing. Cajas ÷ cajas por pallet = pallets.') },
  { id: 'lote-perdida', group: 'lotes', title: tr('Falta y pérdida'),
    means: tr('Falta es lo que todavía no llega. Pérdida es lo que ya no llegó.'),
    math: tr('Mientras el cuarto trabaja el lote es "falta". Es pérdida cuando pasan 2 días sin que ese cuarto registre nada del lote, y se dice en unidades y en %. % = lo perdido ÷ lo esperado. Cada cuarto responde por lo que recibió; la pérdida total del lote va contra lo que dieron las mezclas.'),
    eg: tr('Se esperaban 480 cajas y salieron 440: pérdida de 40, 8.3%.') },
  { id: 'lote-colores', group: 'lotes', title: tr('Colores de Lotes'),
    means: tr('Qué tan bien va un lote.'),
    math: tr('Verde = completo o pérdida de 2% o menos. Azul = en camino. Amarillo = va atrás o pérdida de 2% a 5%. Rojo = pérdida de más de 5%. "Pérdida de lo terminado" junta solo los lotes que ya salieron de Packing.') },

  { id: 'orden', group: 'pedidos', title: tr('Orden, disponible y pendiente'),
    means: tr('Cuánto queda de una orden de la oficina y cuánto falta por programar.'),
    math: tr('Pendiente del día = lo programado − lo hecho. Disponible = la orden − todo lo hecho. Sin programar = disponible − lo pendiente de los programas de hoy en adelante.'),
    eg: tr('Orden de 1,000 mezclas. Se programan 80 y se hacen 50: pendiente 30, disponible 950, sin programar 920.') },
  { id: 'po-pallets', group: 'pedidos', title: tr('Pallets de un PO: "2 de 3"'),
    means: tr('Cuántos pallets lleva el PO y cuántos pide.'),
    math: tr('Los que pide = cajas del PO ÷ cajas por pallet, redondeado hacia arriba. Ese número no cambia aunque salgan pallets cortos; lo que se hizo sale al lado.'),
    eg: tr('150 cajas en pallets de 50 = 3 pallets.') },
  { id: 'po-completo', group: 'pedidos', title: tr('PO completo'),
    means: tr('Cuándo un PO ya no acepta más pallets.'),
    math: tr('Se decide por cajas: está completo cuando las cajas de sus pallets llegan a las cajas del PO. Si tiene todos sus pallets pero le faltan cajas, todavía acepta otro.') },
  { id: 'vence', group: 'pedidos', title: tr('Vence (vigencia)'),
    means: tr('El día en que vence lo que lleva el pallet.'),
    math: tr('El lote dice el día en que se hizo (año y día del año). Vence = ese día + la vigencia del código en Ajustes › Productos. Sale en rojo si vence antes de la fecha de envío del pedido.'),
    eg: tr('Lote 6289 = 16 de octubre de 2026. Con 45 días, vence el 30 de noviembre.') },
  { id: 'pallet-unido', group: 'pedidos', title: tr('Pallet que completó a otro'),
    means: tr('Dos registros que en realidad son un solo pallet.'),
    math: tr('Cuenta un pallet, y es del que lo terminó. Cada parte sigue con sus cajas, su turno y quien la hizo.'),
    eg: tr('32 cajas de un turno + 16 del otro = 1 pallet de 48.') },
  { id: 'hold', group: 'pedidos', title: tr('On hold'),
    means: tr('Una unidad detenida por un manager o la oficina.'),
    math: tr('Al ponerla se escoge: descontarla (sale de lo hecho mientras está en hold) o que siga contando.') },

  { id: 'peso-resumen', group: 'pesos', title: tr('Resumen de pesos de una hoja'),
    means: tr('Una línea por código y departamento, para quien no necesita el detalle.'),
    math: tr('Veces revisado = cuántas horas se pesó el código, contando lo que más veces se pesó. Cada promedio junta todos los pesos del día de crudo, de cocinado o de pouch (la bolsa terminada) de ese departamento, con sus cocinadores. Pide acción correctiva si un promedio queda fuera del rango de QA, o si un pouch quedó bajo su mínimo. Un peso suelto de bola fuera de rango no cambia el resultado: eso se ve en el Excel completo.') },
  { id: 'peso-pruebas', group: 'pesos', title: tr('Pruebas: "3 de 4"'),
    means: tr('Cuántas pruebas de peso se hicieron de las que tocaban.'),
    math: tr('Las que tocaban = el tiempo que corrió el código ÷ cada cuánto se pesa, sin decimales, corrida por corrida. Una prueba cuenta cuando tiene todos los pesos que se pidieron. "Incompletas" = empezadas con menos pesos. Decir que un cocinador no se usó esa hora cuenta como hecha. Se cuenta desde el 30 de octubre de 2026.'),
    eg: tr('Un código de 2 h 40 min pesado cada 60 min = 2 pruebas.') },
  { id: 'peso-bien', group: 'pesos', title: tr('Bien, bajos, sobre y % en peso'),
    means: tr('Cuántos pesos cayeron dentro del rango de QA.'),
    math: tr('Cada peso se compara con el mínimo y el máximo de Ajustes › KPI. Bien = dentro. Bajo = menos del mínimo. Sobre = más del máximo. % en peso = bien ÷ todos los pesados. Promedio = la suma de los pesos ÷ cuántos son.'),
    eg: tr('10 pesados, rango 48 a 52: 8 bien, 1 bajo y 1 sobre = 80% en peso.') },
  { id: 'peso-rinde', group: 'pesos', title: tr('Rendimiento de cocción'),
    means: tr('Cuánto peso queda después de cocinar, por cocinador.'),
    math: tr('Promedio cocinado ÷ promedio crudo, del mismo código y cocinador. Se pierde = 100% − eso.'),
    eg: tr('2.25 oz ÷ 2.70 oz = 83.3%. Se pierde 16.7%.') },
  { id: 'peso-color', group: 'pesos', title: tr('Color de la tarjeta de Pesos en el KPI'),
    means: tr('Cómo va el día en pesos.'),
    math: tr('Rojo = más de 10% de los pesos fuera de rango, o menos de 90% de las pruebas hechas. Amarillo = algún peso fuera, o faltó alguna prueba. Verde = todo bien. Gris = no tocaba ninguna prueba.') },

  { id: 'asistencia', group: 'gente', title: tr('Asistencia'),
    means: tr('Cuánta gente vino contra la que se esperaba.'),
    math: tr('Esperados = lo escrito en Ajustes › Asistencia, por turno. Vinieron = los anotados que siguen ahí (quien se fue no cuenta aquí). % Asistencia = vinieron ÷ esperados. Faltan = esperados − vinieron. % Falta = faltan ÷ esperados. La barra sale roja desde 25%.'),
    eg: tr('20 esperados y 16 vinieron: 80% de asistencia, faltan 4, 20% de falta.') },

  { id: 'kpi-horas', group: 'kpi', title: tr('Horas-persona'),
    means: tr('Las horas que trabajó la gente, sumadas persona por persona.'),
    math: tr('Por persona: desde el inicio del turno (o desde que llegó) hasta el final del turno (o hasta que se fue), menos el almuerzo si se quedó lo suficiente (Ajustes). Luego se suman todas. Aquí "Vinieron" sí cuenta a quien ya se fue; solo no cuenta a quien mandaron a otro cuarto, que cuenta allá.') },
  { id: 'kpi-prod', group: 'kpi', title: tr('Productividad: por hora-persona'),
    means: tr('Cuánto se produjo por cada hora de trabajo de una persona.'),
    math: tr('Por cuarto: lo que hizo ÷ sus horas-persona. Total de la planta: las cajas de Packing ÷ las horas-persona de todos los cuartos.'),
    eg: tr('2,000 cajas ÷ 500 horas-persona = 4 cajas por hora-persona.') },
  { id: 'kpi-costco', group: 'kpi', title: tr('Costco MVM: cada día'),
    means: tr('Lo planeado contra lo hecho del 0889.'),
    math: tr('El plan sale del planner de Yasbelth. Mezclas = las de Spiral. Cajas = las de Packing. Diferencia = cajas − plan. % = cajas ÷ plan. Verde desde 100%, amarillo desde 90%, rojo menos de eso.'),
    eg: tr('Plan 1,800 y 1,620 hechas: diferencia −180, 90%.') },
  { id: 'kpi-mes', group: 'kpi', title: tr('Costco MVM: el mes'),
    means: tr('Cómo va el mes y cuánto hace falta por día para cumplirlo.'),
    math: tr('Plan del mes = la suma de los días planeados. Hecho en el mes = las cajas hasta ese día. Necesario por día = (plan del mes − hecho) ÷ los días planeados que quedan, redondeado hacia arriba. Forecast = lo que dice el planner.'),
    eg: tr('Plan 20,000, hecho 12,000 y quedan 8 días: 1,000 por día.') },
]

function NumbersDialog({ start, onClose }: { start?: NumberId; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<Group | ''>('')
  const first = useRef<HTMLDetailsElement>(null)
  // (opened from a heading: on that number, already open)
  useEffect(() => { first.current?.scrollIntoView({ block: 'start' }) }, [])
  const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const words = plain(q).split(/\s+/).filter(Boolean)
  const all = items()
  const list = all.filter((x) => (!group || x.group === group) && words.every((w) => plain([x.title, x.means, x.math, x.eg ?? ''].join(' ')).includes(w)))
  return (
    <div className="veil" onClick={onClose}>
      <div className="dlg wide gd" onClick={(e) => e.stopPropagation()}>
        <div className="gd-head">
          <h3>{tr('¿Qué significa cada número?')}</h3>
          <button type="button" className="btn sm" onClick={onClose}>{tr('Cerrar')}</button>
        </div>
        <input className="gd-q" value={q} placeholder={tr('Buscar un número o una palabra…')} aria-label={tr('Buscar un número o una palabra…')} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button type="button" className={'chip sm' + (!group ? ' on' : '')} onClick={() => setGroup('')}>{tr('Todos')}</button>
          {groups().map(([g, label]) => <button key={g} type="button" className={'chip sm' + (group === g ? ' on' : '')} onClick={() => setGroup(g)}>{label}</button>)}
        </div>
        {list.length === 0 && <p className="hint">{tr('No se encontró nada con esa búsqueda.')}</p>}
        {list.map((x) => (
          <details key={x.id} ref={x.id === start ? first : undefined} className="gd-item" open={x.id === start || words.length > 0 || undefined}>
            <summary>{x.title}</summary>
            <dl>
              <dt>{tr('Qué significa')}</dt><dd>{x.means}</dd>
              <dt>{tr('Cómo se calcula')}</dt><dd>{x.math}</dd>
              {x.eg && <><dt>{tr('Ejemplo')}</dt><dd>{x.eg}</dd></>}
            </dl>
          </details>
        ))}
      </div>
    </div>
  )
}

/** the link to the window: for managers, the office and whoever only looks; the floor's operators do not get it */
export function WhatIs({ id, label }: { id?: NumberId; label?: string }) {
  const who = useWho()
  const [open, setOpen] = useState(false)
  if (who.role === 'op' && !who.admin) return null
  return (
    <>
      <button type="button" className="lnk whatis" onClick={() => setOpen(true)}>{label ?? tr('¿Qué es esto?')}</button>
      {/* (over the page, not inside the heading: it would take its capitals) */}
      {open && createPortal(<NumbersDialog start={id} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}
