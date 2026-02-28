# Demo de Arquitectura Agéntica

Una aplicación que muestra en tiempo real cómo un agente supervisor coordina dos sub-agentes especializados para responder preguntas usando la API de Claude.

![Next.js](https://img.shields.io/badge/Next.js-15-black) ![Claude API](https://img.shields.io/badge/Claude-API-orange) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## Cómo funciona

El sistema implementa un **pipeline de tres agentes** con roles bien definidos:

```
Usuario
  │
  ▼
🧠 Supervisor          ← Analiza la pregunta y planifica
  │   delega tarea
  ▼
🔍 Researcher          ← Busca en Wikipedia (bucle de herramientas)
  │   devuelve hallazgos
  ▼
🧠 Supervisor          ← Revisa y delega la síntesis
  │   delega síntesis
  ▼
✨ Synthesizer         ← Formatea la respuesta final en Markdown
  │
  ▼
Usuario
```

### Agentes

| Agente | Rol | Herramientas |
|--------|-----|--------------|
| **Supervisor** | Orquestador. Recibe la pregunta, decide qué investigar y en qué formato responder. Coordina a los otros dos agentes. | — |
| **Researcher** | Sub-agente con acceso a herramientas reales. Ejecuta un bucle autónomo buscando y leyendo artículos de Wikipedia hasta recopilar información suficiente. | `search_wikipedia`, `get_wikipedia_article` |
| **Synthesizer** | Sub-agente redactor. Toma los datos en bruto del Researcher y los convierte en una respuesta clara y bien estructurada en Markdown. | — |

### Flujo técnico

1. El frontend envía la pregunta vía `POST /api/research`
2. La API route ejecuta el pipeline y emite eventos en tiempo real mediante **Server-Sent Events (SSE)**
3. Cada evento tipado (`supervisor_start`, `researcher_tool_call`, `synthesizer_done`, etc.) actualiza el estado visual de cada agente en la UI
4. El usuario puede asignar un modelo de Claude diferente a cada agente (Opus, Sonnet o Haiku) para experimentar con distintas combinaciones de capacidad y velocidad

### Stack

- **Next.js 15** con App Router
- **Anthropic SDK** (`@anthropic-ai/sdk`) para llamadas a la API de Claude
- **SSE** para streaming de eventos agente → UI
- **Tailwind CSS** para estilos
- **TypeScript** end-to-end

---

## Despliegue local

### Requisitos

- Node.js 18+
- Una API key de Anthropic ([obtenerla aquí](https://console.anthropic.com/))

### Pasos

**1. Clonar el repositorio**

```bash
git clone https://github.com/santibarclay/agentic-architecture-demo.git
cd agentic-architecture-demo
```

**2. Instalar dependencias**

```bash
npm install
```

**3. Configurar variables de entorno**

```bash
cp .env.example .env.local
```

Editar `.env.local` y agregar tu API key:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**4. Iniciar el servidor de desarrollo**

```bash
npm run dev
```

**5. Abrir en el navegador**

```
http://localhost:3000
```

---

## Experimentar

Una vez en la app podés:

- Escribir cualquier pregunta sobre IA, tecnología o ciencia
- Usar las preguntas de ejemplo para probar rápido
- **Cambiar el modelo** de cada agente de forma independiente (Supervisor, Researcher, Synthesizer) para comparar velocidad vs. capacidad
- Expandir las **instrucciones del sistema** de cada agente para ver exactamente qué prompt recibe
- Observar en tiempo real las llamadas a herramientas del Researcher y los traspasos entre agentes

### Preguntas de ejemplo incluidas

- ¿Qué es RAG (Retrieval Augmented Generation)?
- ¿Cómo funcionan los transformers en inteligencia artificial?
- ¿Qué es el aprendizaje por refuerzo?
- ¿Cómo funciona la memoria en los modelos de lenguaje?

---

## Estructura del proyecto

```
├── app/
│   ├── api/research/route.ts   # Pipeline agéntico + SSE
│   ├── page.tsx                # UI con visualización en tiempo real
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   └── types.ts                # Tipos de eventos y system prompts
├── .env.example                # Plantilla de variables de entorno
└── package.json
```
