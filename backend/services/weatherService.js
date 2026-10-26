import axios from 'axios';
import { getDemoWeatherSnapshot } from './sensorSimulator.js';

const OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';

export async function fetchWeather(city = 'Guayaquil') {
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (!apiKey) {
    return {
      ...getDemoWeatherSnapshot(city),
      isDemoMode: true,
      note: 'OpenWeather API key not configured. Demo data is displayed until live credentials are added.',
    };
  }

  try {
    const response = await axios.get(OPENWEATHER_URL, {
      params: {
        q: city,
        appid: apiKey,
        units: 'metric',
      },
      timeout: 8000,
    });

    const data = response.data;
    return {
      city: data.name || city,
      weatherSummary: data.weather?.[0]?.main || 'Weather data',
      temperature: data.main?.temp ?? null,
      humidity: data.main?.humidity ?? null,
      windSpeed: data.wind?.speed ?? null,
      rainfall: data.rain?.['1h'] ?? data.rain?.['3h'] ?? null,
      condition: data.weather?.[0]?.description || 'Unavailable',
      description: data.weather?.[0]?.description || 'No description available',
      lastUpdated: new Date().toISOString(),
      source: 'OpenWeather API',
      isDemoMode: false,
    };
  } catch (error) {
    return {
      ...getDemoWeatherSnapshot(city),
      isDemoMode: true,
      note: `Live weather unavailable: ${error.response?.data?.message || error.message}`,
    };
  }
}
