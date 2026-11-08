export function TerrainCredit() {
  return (
    <small className="terrain-credit">
      <a
        href="https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM"
        target="_blank"
        rel="noreferrer"
      >
        Copernicus GLO-30
      </a>
      {
        '. Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.'
      }
    </small>
  );
}
