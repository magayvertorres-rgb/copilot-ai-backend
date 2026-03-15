const mqtt = require('mqtt')
  const { GoogleGenerativeAI } = require('@google/generative-ai')

  const MQTT_HOST  = process.env.MQTT_HOST
  const MQTT_PORT  = process.env.MQTT_PORT || 8883
  const MQTT_USER  = process.env.MQTT_USER
  const MQTT_PASS  = process.env.MQTT_PASS
  const BASE_TOPIC = process.env.MQTT_TOPIC || 'magayvercopilot/carro'
  const GEMINI_KEY = process.env.GEMINI_KEY

  const TEL_TOPIC     = `${BASE_TOPIC}/telemetria`
  const INSIGHT_TOPIC = `${BASE_TOPIC}/ia/insights`

  const genAI  = new GoogleGenerativeAI(GEMINI_KEY)
  const model  = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const lastAnalysis = {}

  const client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: `copilot_ai_${Date.now()}`,
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
  })

  client.on('connect', () => {
    console.log(`[MQTT] Conectado: ${MQTT_HOST}`)
    client.subscribe(TEL_TOPIC, { qos: 0 })
    console.log(`[MQTT] Escutando: ${TEL_TOPIC}`)
  })

  client.on('message', async (topic, payload) => {
    if (topic !== TEL_TOPIC) return
    let data
    try { data = JSON.parse(payload.toString()) } catch { return }

    const key = data.vin || 'default'
    const now = Date.now()
    if (lastAnalysis[key] && now - lastAnalysis[key] < 30000) return
    lastAnalysis[key] = now

    console.log(`[AI] Analisando VIN: ${key} | score: ${data.health_score}`)
    try {
      const insight = await analisar(data)
      if (!insight) { console.log('[AI] Tudo normal.'); return }
      client.publish(INSIGHT_TOPIC, JSON.stringify(insight), { qos: 0 })
      console.log(`[AI] Publicado: ${insight.titulo} (${insight.nivel})`)
    } catch (e) {
      console.error('[AI] Erro:', e.message)
    }
  })

  client.on('error', e => console.error('[MQTT] Erro:', e.message))
  client.on('reconnect', () => console.log('[MQTT] Reconectando...'))

  async function analisar(d) {
    const prompt = `Você é especialista em diagnóstico de injeção eletrônica automotiva.
  Analise os dados OBD2 abaixo e responda APENAS em JSON válido, sem markdown.

  Dados:
  RPM: ${d.rpm ?? 'N/D'}
  Velocidade: ${d.speed ?? 'N/D'} km/h
  Temperatura da água: ${d.ect ?? 'N/D'} °C
  Tensão da bateria: ${d.battery ?? 'N/D'} V
  LTFT B1: ${d.ltft_b1 ?? 'N/D'} %
  STFT B1: ${d.stft_b1 ?? 'N/D'} %
  Carga do motor: ${d.load ?? 'N/D'} %
  Sonda O2 B1S1: ${d.o2_b1s1 ?? 'N/D'} V
  Avanço de ignição: ${d.ignition_adv ?? 'N/D'} graus
  Pressão MAP: ${d.map_mbar ?? 'N/D'} mbar
  Score de saúde: ${d.health_score ?? 100}/100
  Alertas ativos: ${d.insights_count ?? 0}

  Regras:
  1. Tudo normal → {"nivel":"normal"}
  2. Anomalia → {"titulo":"frase curta","detalhe":"explicação em 1 frase","sugestao":"ação em 1 frase","nivel":"warning"}
  3. Temperatura acima de 100°C = critical
  4. LTFT fora de ±10% = warning, fora de ±20% = critical
  5. Bateria abaixo de 11.5V com motor ligado = warning`

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
      .replace(/```json/g, '').replace(/```/g, '').trim()
    let json
    try { json = JSON.parse(text) } catch { return null }
    if (json.nivel === 'normal') return null
    return json
  }

  console.log('[CopilotAI] Backend iniciado. Aguardando dados...')
  Commit.
