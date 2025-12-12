import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// Schema for individual city weather data
const cityWeatherSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  condition: z.string(),
  humidity: z.number(),
});

// Schema for activity recommendation
const activitySchema = z.object({
  city: z.string(),
  activities: z.array(z.string()),
  weatherSummary: z.string(),
});

// Helper function to get weather condition from code
function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    51: 'Light drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    95: 'Thunderstorm',
  };
  return conditions[code] || 'Unknown';
}

// Step 1: Fetch weather for a single city (used in foreach loop)
const fetchCityWeather = createStep({
  id: 'fetch-city-weather',
  description: 'Fetches current weather for a single city',
  inputSchema: z.string(),
  outputSchema: cityWeatherSchema,
  execute: async ({ inputData: city }) => {
    // Geocode the city
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = (await geocodingResponse.json()) as {
      results?: { latitude: number; longitude: number; name: string }[];
    };

    if (!geocodingData.results?.[0]) {
      return {
        city,
        temperature: 0,
        condition: 'Location not found',
        humidity: 0,
      };
    }

    const { latitude, longitude, name } = geocodingData.results[0];

    // Fetch weather data
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weathercode`;
    const response = await fetch(weatherUrl);
    const data = (await response.json()) as {
      current: {
        temperature_2m: number;
        relative_humidity_2m: number;
        weathercode: number;
      };
    };

    return {
      city: name,
      temperature: data.current.temperature_2m,
      condition: getWeatherCondition(data.current.weathercode),
      humidity: data.current.relative_humidity_2m,
    };
  },
});

// Step 2: Generate activity recommendations for a city based on weather
const generateActivityRecommendations = createStep({
  id: 'generate-activity-recommendations',
  description: 'Generates activity recommendations based on weather',
  inputSchema: cityWeatherSchema,
  outputSchema: activitySchema,
  execute: async ({ inputData }) => {
    const { city, temperature, condition, humidity } = inputData;

    const activities: string[] = [];

    // Temperature-based activities
    if (temperature > 25) {
      activities.push('🏖️ Beach or pool visit', '🍦 Get ice cream');
    } else if (temperature > 15) {
      activities.push('🚴 Cycling', '🥾 Hiking', '📸 Outdoor photography');
    } else if (temperature > 5) {
      activities.push('☕ Cozy café visit', '🎨 Museum tour');
    } else {
      activities.push('⛷️ Winter sports', '🏠 Indoor activities');
    }

    // Condition-based adjustments
    if (condition.toLowerCase().includes('rain')) {
      activities.length = 0;
      activities.push('🎬 Movie theater', '📚 Library visit', '🎳 Bowling');
    } else if (condition.toLowerCase().includes('clear') || condition.toLowerCase().includes('sunny')) {
      activities.push('🌳 Park picnic', '🌅 Sunset watching');
    }

    const weatherSummary = `${temperature}°C, ${condition}, ${humidity}% humidity`;

    return {
      city,
      activities,
      weatherSummary,
    };
  },
});

// Nested workflow: Process a single city (fetch weather + generate recommendations)
const processSingleCityWorkflow = createWorkflow({
  id: 'process-single-city',
  inputSchema: z.string(),
  outputSchema: activitySchema,
})
  .map(async ({ inputData }) => ({
    city: inputData,
  }))
  .then(
    createStep({
      id: 'fetch-weather-for-city',
      inputSchema: z.object({ city: z.string() }),
      outputSchema: cityWeatherSchema,
      execute: async ({ inputData }) => {
        const { city } = inputData;

        const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
        const geocodingResponse = await fetch(geocodingUrl);
        const geocodingData = (await geocodingResponse.json()) as {
          results?: { latitude: number; longitude: number; name: string }[];
        };

        if (!geocodingData.results?.[0]) {
          return {
            city,
            temperature: 0,
            condition: 'Location not found',
            humidity: 0,
          };
        }

        const { latitude, longitude, name } = geocodingData.results[0];

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weathercode`;
        const response = await fetch(weatherUrl);
        const data = (await response.json()) as {
          current: {
            temperature_2m: number;
            relative_humidity_2m: number;
            weathercode: number;
          };
        };

        return {
          city: name,
          temperature: data.current.temperature_2m,
          condition: getWeatherCondition(data.current.weathercode),
          humidity: data.current.relative_humidity_2m,
        };
      },
    }),
  )
  .then(generateActivityRecommendations);

processSingleCityWorkflow.commit();

// Step: Compare weather across cities and find the best destination
const findBestDestination = createStep({
  id: 'find-best-destination',
  description: 'Analyzes all cities and recommends the best destination',
  inputSchema: z.array(activitySchema),
  outputSchema: z.object({
    bestCity: z.string(),
    reason: z.string(),
    allCities: z.array(
      z.object({
        city: z.string(),
        score: z.number(),
        weatherSummary: z.string(),
        topActivity: z.string(),
      }),
    ),
  }),
  execute: async ({ inputData: cityRecommendations }) => {
    // Score each city based on weather conditions
    const scoredCities = cityRecommendations.map((rec) => {
      let score = 50; // Base score

      // Parse temperature from summary
      const tempMatch = rec.weatherSummary.match(/(-?\d+(?:\.\d+)?)/);
      const temp = tempMatch ? parseFloat(tempMatch[1]) : 20;

      // Temperature scoring (prefer 18-25°C)
      if (temp >= 18 && temp <= 25) {
        score += 30;
      } else if (temp >= 15 && temp <= 28) {
        score += 20;
      } else if (temp < 5 || temp > 35) {
        score -= 20;
      }

      // Condition scoring
      if (rec.weatherSummary.toLowerCase().includes('clear')) {
        score += 20;
      } else if (rec.weatherSummary.toLowerCase().includes('rain')) {
        score -= 15;
      } else if (rec.weatherSummary.toLowerCase().includes('cloud')) {
        score += 5;
      }

      return {
        city: rec.city,
        score,
        weatherSummary: rec.weatherSummary,
        topActivity: rec.activities[0] || 'Explore the city',
      };
    });

    // Sort by score
    scoredCities.sort((a, b) => b.score - a.score);

    const best = scoredCities[0];

    return {
      bestCity: best.city,
      reason: `${best.city} has the best weather conditions with ${best.weatherSummary}. Top recommended activity: ${best.topActivity}`,
      allCities: scoredCities,
    };
  },
});

// Main workflow: Process multiple cities using foreach (map) and nested workflows
export const multiCityWeatherWorkflow = createWorkflow({
  id: 'multi-city-weather-workflow',
  inputSchema: z.object({
    cities: z.array(z.string()).describe('List of cities to check weather for'),
  }),
  outputSchema: z.object({
    bestCity: z.string(),
    reason: z.string(),
    allCities: z.array(
      z.object({
        city: z.string(),
        score: z.number(),
        weatherSummary: z.string(),
        topActivity: z.string(),
      }),
    ),
  }),
})
  // Map input to extract cities array for foreach
  .map(async ({ inputData }) => inputData.cities)
  // Use foreach to process each city with the nested workflow (concurrent processing)
  .foreach(processSingleCityWorkflow, { concurrency: 3 })
  // Find the best destination from all results
  .then(findBestDestination);

multiCityWeatherWorkflow.commit();

