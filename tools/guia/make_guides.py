import os, sys, html
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

CSS = """
@page{size:letter;margin:14mm 13mm}
*{box-sizing:border-box}
body{font:13.5px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0}
.top{display:flex;align-items:center;gap:14px;border-bottom:4px solid var(--c);padding-bottom:8px;margin-bottom:10px}
.top .emo{font-size:40px}
.top h1{margin:0;font-size:26px}.top p{margin:2px 0 0;color:#475569}
h2{font-size:17px;margin:14px 0 6px;color:var(--c);border-bottom:1px solid #e2e8f0;padding-bottom:3px;break-after:avoid}
h3{font-size:14px;margin:10px 0 4px;break-after:avoid}
ol,ul{margin:4px 0 6px;padding-left:22px}li{margin:3px 0}
.btn{display:inline-block;border:1.5px solid #0b5e57;background:#0f766e;color:#fff;font-weight:700;border-radius:7px;padding:0 6px;font-size:12.5px;white-space:nowrap}
.btn.soft{background:#e6f2f0;color:#0f766e;border-color:#9fd1c9}.btn.red{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}.btn.amb{background:#fff4e5;color:#b45309;border-color:#f59e0b}.btn.grey{background:#e2e8f0;color:#0f172a;border-color:#cbd5e1}
.box{border-radius:10px;padding:8px 11px;margin:8px 0;break-inside:avoid}
.tip{background:#ecfdf5;border:1px solid #86efac}.warn{background:#fff7ed;border:1px solid #fdba74}.rule{background:#eef2ff;border:1px solid #c7d2fe}
.box b.t{display:block;margin-bottom:2px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.step{break-inside:avoid}
.foot{margin-top:14px;color:#64748b;font-size:11px;border-top:1px solid #e2e8f0;padding-top:6px}
.pb{break-before:page}
"""

def B(t, k=''): return f'<span class="btn {k}">{html.escape(t)}</span>'

COMMON = f"""
<h2>1 · Entrar a la app</h2>
<ol>
<li>Abre <b>Actividad</b> en la tablet de tu cuarto (el ícono azul). Si pide usuario, entra con <b>tu usuario y tu PIN</b>: todo lo que registres lleva tu nombre.</li>
<li>Arriba ves la fecha, la hora y tu cuarto. A la izquierda, los cuartos; el tuyo está marcado.</li>
<li>Si arriba dice <i>"El día de hoy todavía no se ha empezado"</i>, el supervisor toca {B('▶ Empezar el día')} (si su usuario lo permite).</li>
</ol>
<div class="box warn"><b class="t">Barra de arriba</b>Verde = todo se está mandando al servidor. Si sale una <b>barra roja</b> con {B('Entrar de nuevo','red')}, tócalo y vuelve a entrar con tu usuario: lo que registraste no se pierde, se manda al entrar.</div>

<h2>2 · La pantalla de tu cuarto</h2>
<ul>
<li>Pestañas: {B('En vivo','grey')} (las líneas trabajando ahora), {B('Terminados','grey')} (lo que se terminó hoy), {B('Programa','grey')} (lo que la oficina programó hoy).</li>
<li>Cada <b>línea</b> es una tarjeta: arriba su nombre y si está <i>Corriendo</i>, <i>Parado</i> o en <i>Set up</i>; en grande el <b>código</b> y el <b>lote</b>; abajo los botones.</li>
<li>Arriba de las líneas está el total del turno y la meta, si la oficina puso una.</li>
</ul>

<h2>3 · Empezar un código en una línea</h2>
<ol>
<li>En una línea libre escribe el <b>código</b> y el <b>lote</b>. Si el código está en el programa de hoy, sale como botón: tócalo y se llena solo.</li>
<li>Contesta lo que pregunte (cada cuarto tiene sus preguntas: mira la parte de tu cuarto).</li>
<li>Toca {B('▶ Empezar')}.</li>
</ol>

<h2>4 · Registrar el trabajo</h2>
<ul>
<li>Cada vez que termina una unidad, toca <b>una vez</b> el botón verde grande ({B('✓ Mezcla lista')}, {B('✓ Carro listo')}, {B('✓ Bin listo')}, {B('✓ Pallet listo')}…).</li>
<li>La tarjeta se pone verde y dice <i>"guardado"</i>: ya quedó. <b>No toques dos veces.</b></li>
<li>Si te equivocaste, toca <b>Corregir</b> en la línea (código, lote o unidades) o pide al manager.</li>
</ul>

<h2>5 · Paros y Set up</h2>
<ul>
<li>Si la línea se para: {B('⏸ Parar','red')} y escoge la razón. Cuando vuelvan a trabajar: {B('▶ Reanudar','red')}.</li>
<li>Si preparan la línea para otro código: {B('⏱ Set up','amb')}; al terminar de preparar: {B('✓ Set up listo','amb')}.</li>
<li>Si se para <b>todo el cuarto</b> (break, falta de producto…): {B('⏸ Parar departamento','red')} arriba del cuarto.</li>
<li>Producto perdido: {B('Waste (lb)','grey')} y escribe las libras.</li>
</ul>

<h2>6 · Terminar un código y el turno</h2>
<ul>
<li>Cuando acaban un código: {B('■ Terminar código','grey')}. Si viene otro código, la app pregunta si van a hacer Set up.</li>
<li>Al irse, si nada sigue: {B('🏁 Terminar turno','grey')} arriba del cuarto. <b>Si el otro turno sigue con el mismo código, no terminen: déjenlo corriendo.</b></li>
<li>Cuando llega el turno 2 a un cuarto que sigue trabajando: {B('▶ Empezar Turno 2','soft')}.</li>
</ul>

<div class="box rule"><b class="t">Reglas de la app</b>
<ul>
<li>La app <b>nunca para nada sola</b> por la hora: lo terminan ustedes.</li>
<li><b>Nada se borra de verdad</b>: lo corregido o quitado queda guardado en el servidor.</li>
<li><b>Sin WiFi la app sigue funcionando</b>: guarda en la tablet y lo manda solo cuando vuelve la señal. No cierres la sesión.</li>
<li>Registra en el momento, no al final del turno: así la oficina ve lo que pasa en vivo.</li>
</ul></div>
"""

ATT = f"""
<h2>Asistencia (cuando la oficina la prenda)</h2>
<ul>
<li>En tu cuarto sale la tarjeta {B('👥 Asistencia')}: toca {B('Anotar personas','soft')}.</li>
<li>Escribe el nombre o número de cada persona y {B('+ Anotar')}. Escoge la línea, y si es <b>Temporal (agencia)</b>.</li>
<li>Si alguien se va: {B('✕ Sacar','grey')} (se fue a su casa, o anotado por error). Si pasa a otra línea o cuarto: {B('⇄ Trasladar','soft')}.</li>
</ul>
"""

ROOMS = {
 'Kitchen': dict(emo='🍲', c='#a21caf', sub='Braisers · se cuenta por mezcla', body=f"""
<h2>Kitchen · cómo se trabaja</h2>
<ul>
<li>Las líneas de Kitchen son los <b>braisers</b> (Braiser 1, Braiser 2…).</li>
<li>Al empezar: el <b>código de la receta</b> (por ejemplo 2286) y el <b>lote</b>.</li>
<li>Cada mezcla terminada: {B('✓ Mezcla lista')}.</li>
</ul>
<div class="box warn"><b class="t">El programa pone el tope</b>Si la oficina programó, por ejemplo, <b>10 mezclas</b> de un código, la app deja registrar <b>hasta 10, ni una más</b>. Al llegar sale <i>"✓ Programa completo"</i>. Si tocan una más, sale un aviso y <b>no se registra</b>:
<ul><li>¿Es otro código? Toquen {B('Corregir el código','soft')}.</li><li>¿Hay que hacer más? <b>Vayan a la oficina</b>: solo la oficina lo autoriza, subiendo la cantidad en el programa.</li></ul></div>
"""),
 'Spiral': dict(emo='🌀', c='#4f46e5', sub='Líneas y racks · se cuenta por mezcla (o en libras / cajas)', body=f"""
<h2>Spiral · cómo se trabaja</h2>
<ul>
<li>Al empezar: código y lote, y <b>¿en qué se cuenta este código?</b> → <b>Mezclas</b> (lo normal), <b>Libras</b> o <b>Cajas</b>, según el producto.</li>
<li>Cada mezcla terminada: {B('✓ Mezcla lista')}. Si se cuenta en libras o cajas, la app pregunta cuántas.</li>
<li>El mismo código se puede escribir 889 o 0889: la app los toma como el mismo.</li>
</ul>
<h2>⚖ Pesar las bolas del 0889 (cada hora)</h2>
<ul>
<li>Mientras corre el <b>0889</b>, cada hora sale el aviso amarillo <i>"⚖ Ya pasó 1 hora…"</i>. Tóquenlo, o {B('⚖ Peso','grey')}.</li>
<li>La ventana tiene <b>4 pruebas</b>: <b>Crudo · Spiral</b>, <b>Cocinado · Spiral</b>, <b>Crudo · Racks</b> y <b>Cocinado · Racks</b>. Gris = falta, amarillo = toca ahora, verde ✓ = hecha.</li>
<li><b>Crudo</b>: 10 bolas <b>antes de que entren</b> a cocinar. <b>Cocinado</b>: 10 bolas <b>al salir</b>.</li>
<li>Cada bola <b>una por una</b>: escriban el peso en <b>onzas (oz)</b> y {B('+ Agregar')}. La app dice sola si está bajo o sobre. Al llegar a 10 pasa sola a la prueba siguiente.</li>
<li>Si Racks (o Spiral) <b>no cocinó esa hora</b>, toquen <b>"Racks no cocinó esta hora"</b>: no se cuenta como prueba que falta.</li>
<li>Cada peso ya queda guardado. Si se equivocan: <b>Quitar el último</b>. Si cierran la ventana a la mitad, al abrirla siguen con la misma prueba.</li>
</ul>
<div class="box warn"><b class="t">El programa pone el tope (mezclas)</b>Si la oficina programó, por ejemplo, <b>10 mezclas</b> de un código y lote, la app deja registrar <b>hasta 10, ni una más</b>. Al llegar sale <i>"✓ Programa completo"</i>. Si tocan una más, <b>no se registra</b>:
<ul><li>¿Pusieron el mismo código pero era otro? Toquen {B('Corregir el código','soft')}.</li><li>¿Hay que hacer más? <b>Vayan a la oficina</b>: solo la oficina lo autoriza, subiendo la cantidad en el programa.</li></ul></div>
"""),
 'RTE': dict(emo='🛒', c='#0369a1', sub='Líneas de pouches · se cuenta por carro', body=f"""
<h2>RTE · cómo se trabaja</h2>
<ul>
<li>Al empezar: código, lote y <b>pouches por carro</b> (por ejemplo 240).</li>
<li>Cada carro lleno: {B('✓ Carro listo')}. La app propone los pouches del carro; si el carro lleva otra cantidad, cámbiala antes de guardar.</li>
<li>Pouches dañados o tirados: {B('Waste (lb)','grey')}.</li>
</ul>
<h2>⚖ Peso de los pouches</h2>
<ul>
<li>Mientras corre el <b>0889</b>, cada hora sale el aviso amarillo <i>"⚖ Ya pasó 1 hora…"</i>. Tóquenlo, o {B('⚖ Peso','grey')}.</li>
<li>Pesen <b>10 pouches, uno por uno</b>: escriban el peso en <b>onzas (oz)</b> y {B('+ Agregar')}. La app dice sola cuál está <b>bajo</b> (menos de 48 oz) o <b>sobre</b> (más de 52 oz).</li>
<li>Cada peso ya queda guardado. Si se equivocan: <b>Quitar el último</b>. Si cierran la ventana a la mitad, al abrirla siguen con la misma prueba.</li>
</ul>
"""),
 'MFO': dict(emo='🍽️', c='#4d7c0f', sub='Líneas de platos, copas y bags · se cuenta por bin', body=f"""
<h2>MFO · cómo se trabaja</h2>
<ul>
<li>Al empezar: código, lote y <b>¿en qué se llena y qué lleva?</b>
<ul><li><b>Platos</b> o <b>Copas</b>: cada bin dice cuántos.</li><li><b>Libras</b>: cada bin se pesa.</li><li><b>Bags</b>: para el <b>roaster</b>; cada bag se pesa en libras.</li></ul></li>
<li>Cada bin (o bag) lleno: {B('✓ Bin listo')} / {B('✓ Bag lista')} y escribe cuántos platos, copas o libras lleva. El <b>N° de bin</b> es opcional.</li>
<li>La próxima vez que empiecen un código en esa línea, ya sale escogido lo mismo.</li>
</ul>
<div class="box tip"><b class="t">Roaster</b>Si el roaster ya está corriendo como "bin", terminen el código y empiécenlo otra vez escogiendo <b>Bags</b>.</div>
"""),
 'Packing': dict(emo='📦', c='#92400e', sub='Pallets, bins y pedidos (PO)', body=f"""
<h2>Packing · cómo se trabaja</h2>
<ul>
<li>Al empezar: código, lote y <b>¿qué van a hacer?</b> → <b>Pallets</b> (cajas por pallet) o <b>Bins</b> (platos, copas, pouches…).</li>
<li>Pallet terminado: {B('✓ Pallet listo')} → escribe las <b>cajas</b> de cada lote, su <b>tag</b> y el <b>PO</b>. La app propone el pedido que toca (primero el urgente).</li>
<li>Si el pallet sale <b>corto</b>, la app pide la razón (último del código, último del PO, falta de producto…).</li>
<li>Si el PO ya está completo, la app avisa y <b>no deja ponerle más pallets</b>.</li>
<li>Bins: {B('✓ Bin listo')}. Si cambia el lote a la mitad: <b>¿Cambió el lote?</b></li>
</ul>
<h2>Pedidos y avisos de la oficina</h2>
<ul>
<li>Arriba de Packing, en todas las pestañas (también <b>En vivo</b>), salen:
<ul><li>📢 <b>Mensaje de la oficina</b> (amarillo): léanlo y toquen {B('✓ Entendido')}.</li><li>🔥 <b>Pedidos urgentes</b> (rojo): qué código, cliente, cuántas cajas faltan y cuándo sale. Hagan esos primero.</li></ul></li>
<li>Pestaña {B('Pedidos','grey')}: cada PO con lo pedido, lo hecho y lo que falta. Toca el PO para ver sus pallets.</li>
<li>Si un pedido no se puede hacer: {B('💬 Comentario','soft')} y escriban por qué (la oficina lo ve).</li>
</ul>
"""),
}

def page(room, d):
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de la tablet · {room}</title><style>:root{{--c:{d['c']}}}{CSS}</style></head><body>
<div class="top"><span class="emo">{d['emo']}</span><div><h1>Guía de la tablet · {room}</h1><p>{d['sub']} · App Actividad · Mama's Creations · East Rutherford</p></div></div>
{d['body']}
<div class="top" style="margin-top:16px"><span class="emo">📱</span><div><h1>Lo de siempre, para todos los cuartos</h1><p>Cómo se usa Actividad en cualquier cuarto</p></div></div>
{COMMON}
{ATT}
<div class="foot" style="display:flex;gap:12px;align-items:center"><img src="qr.svg" style="width:70px;height:70px"><span>Escanea para abrir las guías de todos los cuartos en el teléfono: jose2724.github.io/actividad/guia · Dudas o algo que no funciona: avísale a Jose García. Guía de octubre de 2026.</span></div>
</body></html>"""

for room, d in ROOMS.items():
    open(os.path.join(OUT, f'guia-{room.lower()}.html'), 'w', encoding='utf-8').write(page(room, d))

# the page the QR opens: one button per room
links = ''.join(f'<a class="r" style="--c:{d["c"]}" href="guia-{r.lower()}.pdf"><span>{d["emo"]}</span><b>{r}</b><small>{d["sub"]}</small></a>' for r, d in ROOMS.items())
index = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guía de la tablet</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#f1f5f9;color:#0f172a;font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
.w{{max-width:560px;margin:0 auto;padding:18px 16px}}h1{{margin:0 0 4px;font-size:24px}}p{{margin:0 0 16px;color:#475569}}
.r{{display:grid;grid-template-columns:52px 1fr;grid-template-rows:auto auto;align-items:center;gap:0 12px;background:#fff;border:1px solid #e2e8f0;border-left:7px solid var(--c);border-radius:14px;padding:12px 14px;margin:0 0 10px;text-decoration:none;color:inherit;box-shadow:0 2px 0 #e2e8f0}}
.r span{{grid-row:1/3;font-size:34px;text-align:center}}.r b{{font-size:20px}}.r small{{color:#64748b}}
.f{{color:#64748b;font-size:13px;margin-top:14px}}</style></head><body><div class="w">
<h1>📱 Guía de la tablet · Actividad</h1><p>Escoge tu cuarto para abrir su guía (PDF).</p>{links}
<p class="f">Mama's Creations · East Rutherford · Dudas: Jose García.</p></div></body></html>"""
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(index)
rows = ''.join(f'<li style="--c:{d["c"]}"><span>{d["emo"]}</span>{r}</li>' for r, d in ROOMS.items())
poster = f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de la tablet · QR</title><style>@page{{size:letter;margin:16mm}}body{{font:18px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;text-align:center;margin:0}}
h1{{font-size:40px;margin:10px 0 4px}}p{{font-size:20px;color:#475569;margin:0 0 14px}}img{{width:420px;height:420px;border:10px solid #0f766e;border-radius:18px;padding:8px}}
ul{{list-style:none;padding:0;display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:18px 0}}li{{border:2px solid var(--c);border-radius:12px;padding:6px 14px;font-weight:800;font-size:22px}}li span{{margin-right:6px}}
.u{{font-family:ui-monospace,Consolas,monospace;font-size:22px;color:#0f766e;margin-top:6px}}.s{{font-size:16px;color:#64748b}}</style></head><body>
<h1>📱 Guía de la tablet · Actividad</h1><p>Escanea con la cámara del teléfono y escoge tu cuarto</p><img src="qr.svg"><ul>{rows}</ul>
<div class="u">jose2724.github.io/actividad/guia</div><p class="s">Mama's Creations · East Rutherford · Dudas: Jose García</p></body></html>'''
open(os.path.join(OUT, 'cartel-qr.html'), 'w', encoding='utf-8').write(poster)
print('ok')
