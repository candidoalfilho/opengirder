import { defaultTemplate, PRESETS, type Preset, type TemplateKind } from '@opengirder/engine'
import { useStore } from '../store'
import { openModel } from '../io/fileio'
import { BridgeGlyph, IconMoon, IconOpen, IconPlus, IconSun, LogoMark } from '../ui/icons'
import { blankModel } from '../editor/blank'
import { startBlank } from '../editor/session'

const NEW_BUTTONS: { kind: TemplateKind; label: string }[] = [
  { kind: 'girder', label: 'Nova ponte de vigas' },
  { kind: 'cable-stayed', label: 'Nova ponte estaiada' },
  { kind: 'suspension', label: 'Nova ponte pênsil' },
  { kind: 'arch', label: 'Nova ponte em arco' },
]

function HeroArt() {
  // elevação estilizada de uma ponte pênsil com vãos laterais
  const hangers = []
  for (let i = 1; i < 40; i++) {
    const x = 300 + i * 10
    const t = (x - 300) / 400
    const y = 14 + 384 * t * (1 - t)
    hangers.push(<path key={i} d={`M${x} ${y.toFixed(1)}V118`} strokeWidth={0.7} opacity={0.7} />)
  }
  return (
    <svg className="start-art" viewBox="0 0 1000 150" fill="none" stroke="currentColor" strokeLinecap="round" preserveAspectRatio="xMidYMid meet">
      <path d="M0 118h1000" strokeWidth={3} />
      <path d="M300 146V10M700 146V10" strokeWidth={5} />
      <path d="M40 112Q200 96 300 14Q500 206 700 14Q800 96 960 112" strokeWidth={2} />
      {hangers}
      <path d="M0 146h1000" strokeWidth={1} opacity={0.35} strokeDasharray="2 6" />
    </svg>
  )
}

export function StartScreen() {
  const openWizard = useStore((s) => s.openWizard)
  const loadPreset = useStore((s) => s.loadPreset)
  const loadModel = useStore((s) => s.loadModel)
  const notify = useStore((s) => s.notify)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const hasModel = useStore((s) => !!s.model)
  const backToModel = useStore((s) => s.closeWizard)

  const onPreset = (p: Preset) => {
    try {
      loadPreset(p)
    } catch (err) {
      notify(`Não foi possível gerar o modelo: ${err instanceof Error ? err.message : String(err)}`, 'err')
    }
  }

  const onNew = (kind: TemplateKind) => {
    try {
      openWizard(defaultTemplate(kind))
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  const onOpen = async () => {
    try {
      const r = await openModel()
      if (r) loadModel(r.model, r.path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  return (
    <div className="start">
      <div className="start-inner">
        <div className="start-hero">
          <div style={{ flex: 1 }}>
            <h1 className="wordmark">
              <LogoMark size={46} />
              <span>
                Open<b>Girder</b>
              </span>
            </h1>
            <p className="tagline">Análise e verificação de pontes — vigas, arcos, estaiadas e pênseis — com as normas brasileiras. Gratuito e de código aberto.</p>
          </div>
          <button
            className="btn-icon tip-down-left"
            data-tip={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </div>

        <HeroArt />

        <div className="start-actions">
          {NEW_BUTTONS.map((b, i) => (
            <button key={b.kind} className={`btn btn-lg ${i === 0 ? 'btn-primary' : ''}`} onClick={() => onNew(b.kind)}>
              <IconPlus size={14} />
              {b.label}
            </button>
          ))}
          <button className="btn btn-lg" onClick={() => startBlank(blankModel())} title="Desenhe a ponte do zero no editor gráfico">
            <IconPlus size={14} />
            Modelo em branco
          </button>
          <button className="btn btn-lg" onClick={onOpen}>
            <IconOpen size={14} />
            Abrir arquivo
          </button>
          {hasModel && (
            <button className="btn btn-lg btn-ghost" onClick={backToModel}>
              Voltar ao modelo aberto
            </button>
          )}
        </div>

        <h3>Modelos prontos</h3>
        <div className="card-grid">
          {PRESETS.map((p: Preset) => (
            <button key={p.id} className="card" onClick={() => onPreset(p)}>
              <div className="glyph">
                <BridgeGlyph kind={p.template.kind} />
              </div>
              <h4>{p.label}</h4>
              <p>{p.description}</p>
            </button>
          ))}
        </div>

        <div className="start-foot">
          <span className="mono">v{__APP_VERSION__}</span>
          <span>Licença MIT</span>
          <span>NBR 7188 — TB-450 / TB-240</span>
          <span>Cabos de catenária · não linearidade geométrica · form-finding · análise modal</span>
        </div>
      </div>
    </div>
  )
}
