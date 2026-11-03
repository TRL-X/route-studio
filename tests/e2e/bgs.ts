import type { Route } from '@playwright/test';

export const bgsRequests = 'https://geomag.bgs.ac.uk/web_service/GMModels/wmm/2025/**';
export async function answerBgs(route: Route, degrees = -3.456) {
  const params = new URL(route.request().url()).searchParams;
  await route.fulfill({
    json: {
      'geomagnetic-field-model-result': {
        model: 'wmm',
        model_revision: '2025',
        date: { value: params.get('date') },
        coordinates: {
          latitude: { value: Number(params.get('latitude')) },
          longitude: { value: Number(params.get('longitude')) },
          altitude: { value: 0 },
        },
        'field-value': { declination: { units: 'deg (east)', value: degrees } },
      },
    },
  });
}
