/** Ventana de una palabra: pronunciación, traducción y guardar en vocabulario. */
import { esc } from "../core/utils.js";
import { api } from "../core/api.js";
import { modal, toast } from "./components.js";
import { pronounce, speak } from "../learn/pronunciation.js";
import { vocab } from "../learn/study.js";

export async function wordPopup(word, { context = "", songId = null } = {}) {
  const clean = word.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
  if (!clean) return;
  const saved = await vocab.get(clean);
  modal(
    `<h2 style="font-size:30px">${esc(clean)}</h2>
     <div id="wp-pr" class="muted">Cargando pronunciación…</div>
     <div id="wp-tr" style="margin-top:10px;font-size:20px;color:var(--es)"></div>
     ${context ? `<p class="small dim" style="margin-top:14px">«${esc(context)}»</p>` : ""}
     <div class="acts">
       <button class="btn" data-say>🔊 Escuchar</button>
       <button class="btn" data-slow>🐢 Despacio</button>
       <button class="btn primary" data-save>${saved ? "✓ Guardada" : "★ Guardar en vocabulario"}</button>
       <button class="btn ghost" data-close>Cerrar</button>
     </div>`,
    {
      async onMount(box) {
        const h = await api.health();
        let info = null, translation = saved?.translation || "";
        box.querySelector("[data-say]").onclick = () => speak(clean).catch((e) => toast(e.message, "err"));
        box.querySelector("[data-slow]").onclick = () => speak(clean, { rate: 0.6 }).catch((e) => toast(e.message, "err"));
        box.querySelector("[data-save]").onclick = async (e) => {
          await vocab.add({ word: clean, translation, context, songId, ipa: info?.ipa || "", approx: info?.approx || "" });
          e.target.textContent = "✓ Guardada";
          toast("Palabra guardada en tu vocabulario");
        };
        if (!h.ok) {
          box.querySelector("#wp-pr").textContent = "Arranca el servidor local para ver la pronunciación y la traducción.";
          return;
        }
        info = await pronounce(clean);
        box.querySelector("#wp-pr").innerHTML = info
          ? `<div style="color:var(--pron);font-size:20px;font-style:italic">${esc(info.approx)}</div><div style="color:#c6b7ff">IPA: /${esc(info.ipa)}/</div><div class="small dim">Pronunciación aproximada para hispanohablantes, orientativa.</div>`
          : "Sin datos de pronunciación.";
        if (!translation && h.argos) {
          try {
            translation = (await api.translate([clean])).translations[0];
          } catch (e) {
            box.querySelector("#wp-tr").innerHTML = `<span class="small muted">No se pudo traducir: ${esc(e.message)}</span>`;
          }
        }
        if (translation) box.querySelector("#wp-tr").textContent = translation;
        else if (!h.argos) box.querySelector("#wp-tr").innerHTML = `<span class="small muted">Instala Argos Translate para ver la traducción.</span>`;
      },
    },
  );
}
