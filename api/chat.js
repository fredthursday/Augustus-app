// Vercel serverless function — keeps your Anthropic API key private.
// The browser never sees this key; it only talks to /api/chat.
// Set ANTHROPIC_API_KEY in your Vercel project's Environment Variables.
// Optional: set BRAVE_API_KEY to enable web search (free tier at brave.com/search/api).

const TOOLS = [
  {
    name: "calculate",
    description: "Evaluate a math expression or unit conversion. Use for any arithmetic, percentages, or unit conversions (e.g. miles to km, F to C).",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "A math expression, e.g. '12 * (4 + 7)' or '70 fahrenheit to celsius' or '5 miles to km'" },
      },
      required: ["expression"],
    },
  },
  {
    name: "get_weather",
    description: "Get current weather and short forecast for a place. Use whenever the user asks about weather, temperature, rain, or whether to bring an umbrella/jacket.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City and country/region, e.g. 'Austin, Texas' or 'London, UK'" },
      },
      required: ["location"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for current information — news, prices, facts that may have changed recently, or anything outside general knowledge.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A short, specific search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "save_note",
    description: "Save a short note or fact the user explicitly asks you to remember (e.g. 'remember that...', 'save this'). Do not use this for casual conversation — only when the user clearly wants something stored for later recall.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The exact thing to remember, written concisely" },
      },
      required: ["note"],
    },
  },
];

// ---------- Tool implementations ----------

function safeCalculate(expression) {
  try {
    const unitMatch = expression.match(/^\s*([\d.\-]+)\s*([a-zA-Z°]+)\s*(?:to|in)\s*([a-zA-Z°]+)\s*$/i);
    if (unitMatch) {
      return convertUnits(parseFloat(unitMatch[1]), unitMatch[2].toLowerCase(), unitMatch[3].toLowerCase());
    }
    // Plain arithmetic only — no letters allowed, to keep eval safe.
    if (!/^[\d\s+\-*/().%^]+$/.test(expression)) {
      return { error: "Could not parse as a plain math expression or unit conversion." };
    }
    const sanitized = expression.replace(/\^/g, "**");
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${sanitized})`)();
    return { result };
  } catch {
    return { error: "Could not evaluate that expression." };
  }
}

function convertUnits(value, from, to) {
  const temp = { f: "fahrenheit", c: "celsius", k: "kelvin", "°f": "fahrenheit", "°c": "celsius" };
  from = temp[from] || from;
  to = temp[to] || to;

  const tempConversions = {
    "fahrenheit-celsius": (v) => (v - 32) * (5 / 9),
    "celsius-fahrenheit": (v) => v * (9 / 5) + 32,
    "celsius-kelvin": (v) => v + 273.15,
    "kelvin-celsius": (v) => v - 273.15,
    "fahrenheit-kelvin": (v) => ((v - 32) * (5 / 9)) + 273.15,
    "kelvin-fahrenheit": (v) => ((v - 273.15) * (9 / 5)) + 32,
  };
  const key = `${from}-${to}`;
  if (tempConversions[key]) return { result: tempConversions[key](value), unit: to };

  const lengthToMeters = { mile: 1609.34, miles: 1609.34, mi: 1609.34, km: 1000, kilometer: 1000, kilometers: 1000, m: 1, meter: 1, meters: 1, ft: 0.3048, feet: 0.3048, foot: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254, yard: 0.9144, yards: 0.9144 };
  const weightToKg = { lb: 0.453592, lbs: 0.453592, pound: 0.453592, pounds: 0.453592, kg: 1, kilogram: 1, kilograms: 1, g: 0.001, gram: 0.001, grams: 0.001, oz: 0.0283495, ounce: 0.0283495, ounces: 0.0283495 };

  if (lengthToMeters[from] && lengthToMeters[to]) {
    return { result: (value * lengthToMeters[from]) / lengthToMeters[to], unit: to };
  }
  if (weightToKg[from] && weightToKg[to]) {
    return { result: (value * weightToKg[from]) / weightToKg[to], unit: to };
  }
  return { error: `Don't know how to convert ${from} to ${to}.` };
}

async function geocodeLocation(location) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
  const data = await res.json();
  if (!data.results || !data.results.length) return null;
  const r = data.results[0];
  return { lat: r.latitude, lon: r.longitude, label: `${r.name}${r.admin1 ? ", " + r.admin1 : ""}${r.country ? ", " + r.country : ""}` };
}

const WEATHER_CODES = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  80: "rain showers", 81: "rain showers", 82: "violent rain showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

async function getWeather(location) {
  try {
    const geo = await geocodeLocation(location);
    if (!geo) return { error: `Couldn't find a location called "${location}".` };
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&forecast_days=1&timezone=auto`
    );
    const data = await res.json();
    return {
      location: geo.label,
      current_temp_f: data.current?.temperature_2m,
      condition: WEATHER_CODES[data.current?.weather_code] || "unknown",
      humidity_percent: data.current?.relative_humidity_2m,
      wind_mph: data.current?.wind_speed_10m,
      today_high_f: data.daily?.temperature_2m_max?.[0],
      today_low_f: data.daily?.temperature_2m_min?.[0],
      rain_chance_percent: data.daily?.precipitation_probability_max?.[0],
    };
  } catch {
    return { error: "Weather service is unavailable right now." };
  }
}

async function webSearch(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) {
    return { error: "Web search isn't set up yet. Add a BRAVE_API_KEY in Vercel's project settings to enable it (free tier at brave.com/search/api)." };
  }
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
    });
    const data = await res.json();
    const results = (data.web?.results || []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
    if (!results.length) return { results: [], note: "No results found." };
    return { results };
  } catch {
    return { error: "Web search failed." };
  }
}

async function executeTool(name, input) {
  switch (name) {
    case "calculate":
      return safeCalculate(input.expression);
    case "get_weather":
      return getWeather(input.location);
    case "web_search":
      return webSearch(input.query);
    case "save_note":
      // Actual persistence happens client-side; we just acknowledge here.
      return { saved: true, note: input.note };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------- Main handler ----------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel's project settings." });
    return;
  }

  const { messages, system, max_tokens, enable_tools } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const savedNotes = []; // collected during this turn, returned to client to persist

  try {
    let workingMessages = [...messages];
    let finalData = null;

    // Tool-use loop: keep calling Claude until it stops requesting tools (max 4 round-trips for safety)
    for (let round = 0; round < 4; round++) {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: max_tokens || 1000,
          ...(system ? { system } : {}),
          messages: workingMessages,
          ...(enable_tools !== false ? { tools: TOOLS } : {}),
        }),
      });

      const data = await upstream.json();
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: data?.error?.message || "Upstream error" });
        return;
      }

      finalData = data;

      if (data.stop_reason !== "tool_use") break;

      const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
      if (!toolUseBlocks.length) break;

      const toolResults = [];
      for (const block of toolUseBlocks) {
        const result = await executeTool(block.name, block.input || {});
        if (block.name === "save_note" && result.saved) savedNotes.push(result.note);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      workingMessages = [
        ...workingMessages,
        { role: "assistant", content: data.content },
        { role: "user", content: toolResults },
      ];
    }

    res.status(200).json({ ...finalData, saved_notes: savedNotes });
  } catch (err) {
    res.status(500).json({ error: "Failed to reach Claude API" });
  }
}

