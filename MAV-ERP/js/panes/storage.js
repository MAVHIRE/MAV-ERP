// =============================================================================
// MAV RENTAL ERP — 10_storage.gs  v1.0
// Warehouse location management: Zone → Bay → Shelf → Bin
// Barcode-level location tracking with movement history
// Depends on: 00_core.gs, 01_products_inventory.gs
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// WAREHOUSE LOCATIONS
// Hierarchical: Zone → Bay → Shelf → Bin
// Each node has a parentId (null for Zone = top level).
// Full path is stored denormalised for fast display: "A / Bay 3 / Shelf 2 / Bin 4"
// ─────────────────────────────────────────────────────────────────────────────

function saveWarehouseLocation(payload) {
  payload = payload || {};
  requireValue_(payload.locationType, 'locationType is required.');

  const locationId = validId_(payload.locationId) || nextId_('LOCATION_COUNTER', 'LOC');
  const existing   = getWarehouseLocationById(locationId);

  const type = safeString_(payload.locationType);
  const validTypes = Object.values(ENUMS.LOCATION_TYPE);
  if (!validTypes.includes(type)) throw new Error('Invalid location type: ' + type + '. Must be one of: ' + validTypes.join(', '));

  // Derive zone/bay/shelf/bin from fullPath if not explicitly provided
  // e.g. fullPath 'Zone A > Bay A1 > Shelf 1' → zone='Zone A', bay='Bay A1', shelf='Shelf 1'
  var parts = (payload.fullPath || payload.name || '').split(' > ').map(function(s) { return s.trim(); });
  var zone   = payload.zone   || (parts[0] || '');
  var bay    = payload.bay    || (parts[1] || '');
  var shelf  = payload.shelf  || (parts[2] || '');
  var bin    = payload.bin    || (parts[3] || '');

  requireValue_(zone, 'zone is required (or provide fullPath with > separators).');

  // Derive parentId for non-Zone types from existing locations if not provided
  var parentId = payload.parentId || '';
  if (!parentId && type !== ENUMS.LOCATION_TYPE.ZONE) {
    // Look up the parent path (one level up in the hierarchy)
    var parentPath = parts.slice(0, parts.length - 1).join(' > ');
    if (parentPath) {
      var allLocs = readObjects_(MAV.SHEETS.WAREHOUSE_LOCATIONS);
      var parentRow = allLocs.find(function(r) {
        return String(r['Full Path'] || r['Name']) === parentPath;
      });
      if (parentRow) parentId = String(parentRow['Location ID'] || '');
    }
  }

  const fullPath = payload.fullPath || buildLocationPath_(Object.assign({}, payload, { zone: zone, bay: bay, shelf: shelf, bin: bin }));
  const sheet    = getSheet_(MAV.SHEETS.WAREHOUSE_LOCATIONS);

  const row = [
    locationId,
    type,
    safeString_(parentId),
    safeString_(zone),
    safeString_(bay),
    safeString_(shelf),
    safeString_(bin),
    fullPath,
    safeString_(payload.description),
    toNumber_(payload.capacity, 0),
    payload.active !== false ? 'true' : 'false',
    existing ? safeString_(existing.createdAt) || new Date().toISOString() : new Date().toISOString(),
    new Date().toISOString(),
    toNumber_(payload.layoutX, 0),
    toNumber_(payload.layoutY, 0),
    toNumber_(payload.layoutW, 1),
    toNumber_(payload.layoutD, 1),
    toNumber_(payload.layoutH, 2.4),
    toNumber_(payload.layoutShelves, 4),
    safeString_(payload.layoutColor || '#4db8ff'),
    toNumber_(payload.layoutRotation, 0),
  ];

  upsertRow_(sheet, locationId, row);
  writeAuditLog_('WarehouseLocation', locationId, existing ? 'UPDATE' : 'CREATE', '', '', JSON.stringify(payload), 'Location saved');
  return { ok: true, locationId: locationId, fullPath: fullPath };
}

function getWarehouseLocations(filters) {
  filters = filters || {};
  return readObjects_(MAV.SHEETS.WAREHOUSE_LOCATIONS)
    .filter(function(r) {
      return (!filters.locationType || String(r['Location Type']) === String(filters.locationType)) &&
             (!filters.zone         || String(r['Zone'])          === String(filters.zone)) &&
             (!filters.bay          || String(r['Bay'])           === String(filters.bay)) &&
             (!filters.activeOnly   || safeString_(r['Active'])   !== 'false');
    })
    .map(mapWarehouseLocationRow_)
    .sort(function(a, b) { return a.fullPath.localeCompare(b.fullPath); });
}

function getWarehouseLocationById(locationId) {
  if (!locationId) return null;
  const row = readObjects_(MAV.SHEETS.WAREHOUSE_LOCATIONS)
    .find(function(r) { return String(r['Location ID']) === String(locationId); });
  return row ? mapWarehouseLocationRow_(row) : null;
}

function getWarehouseLocationTree() {
  const locations = getWarehouseLocations({ activeOnly: true });
  const zones     = locations.filter(function(l) { return l.locationType === ENUMS.LOCATION_TYPE.ZONE; });

  return zones.map(function(zone) {
    const bays = locations
      .filter(function(l) { return l.locationType === ENUMS.LOCATION_TYPE.BAY && l.parentId === zone.locationId; })
      .map(function(bay) {
        const shelves = locations
          .filter(function(l) { return l.locationType === ENUMS.LOCATION_TYPE.SHELF && l.parentId === bay.locationId; })
          .map(function(shelf) {
            return Object.assign({}, shelf, {
              bins: locations.filter(function(l) { return l.locationType === ENUMS.LOCATION_TYPE.BIN && l.parentId === shelf.locationId; })
            });
          });
        return Object.assign({}, bay, { shelves: shelves });
      });
    return Object.assign({}, zone, { bays: bays });
  });
}

function getWarehouseLocationMap_() {
  const map = {};
  getWarehouseLocations().forEach(function(l) { map[l.locationId] = l; });
  return map;
}

function getLeafLocations() {
  // Returns only the bottom-level locations (Bins if they exist, else Shelves, etc.)
  const all     = getWarehouseLocations({ activeOnly: true });
  const parents = new Set(all.map(function(l) { return l.parentId; }).filter(Boolean));
  return all.filter(function(l) { return !parents.has(l.locationId); });
}

function deleteWarehouseLocation(locationId) {
  requireValue_(locationId, 'locationId is required.');
  // Check nothing is stored here
  const barcodesHere = getBarcodesAtLocation(locationId);
  if (barcodesHere.length) throw new Error('Cannot delete location — ' + barcodesHere.length + ' barcode(s) assigned here.');
  deleteRowsByFirstColumnValue_(MAV.SHEETS.WAREHOUSE_LOCATIONS, locationId);
  writeAuditLog_('WarehouseLocation', locationId, 'DELETE', '', '', '', 'Location deleted');
  return { ok: true, locationId: locationId };
}

// ─────────────────────────────────────────────────────────────────────────────
// BARCODE LOCATION ASSIGNMENT
// Assigns a barcode to a warehouse location and logs the movement.
// ─────────────────────────────────────────────────────────────────────────────

function assignBarcodeLocation(barcode, locationId, notes) {
  requireValue_(barcode,     'barcode is required.');
  requireValue_(locationId,  'locationId is required.');

  const bc       = getBarcodeByCode(barcode);
  if (!bc) throw new Error('Barcode not found: ' + barcode);

  const location = getWarehouseLocationById(locationId);
  if (!location) throw new Error('Location not found: ' + locationId);

  // Update the Barcodes sheet location fields
  const sheet   = getSheet_(MAV.SHEETS.BARCODES);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowIdx  = data.findIndex(function(r, i) { return i > 0 && String(r[0]) === String(barcode); });
  if (rowIdx === -1) throw new Error('Barcode row not found: ' + barcode);

  const locCol      = headers.indexOf('Location ID');
  const pathCol     = headers.indexOf('Location Path');
  const updatedCol  = headers.indexOf('Updated At');

  if (locCol  !== -1) sheet.getRange(rowIdx + 1, locCol  + 1).setValue(locationId);
  if (pathCol !== -1) sheet.getRange(rowIdx + 1, pathCol + 1).setValue(location.fullPath);
  if (updatedCol !== -1) sheet.getRange(rowIdx + 1, updatedCol + 1).setValue(new Date().toISOString());

  // Log in BarcodeLocations history sheet
  const logSheet = getSheet_(MAV.SHEETS.BARCODE_LOCATIONS);
  const logId    = cheapId_('BLG');
  logSheet.appendRow([
    logId,
    barcode,
    bc.productId,
    locationId,
    location.fullPath,
    new Date().toISOString(),
    currentUser_(),
    safeString_(notes)
  ]);

  writeAuditLog_('Barcode', barcode, 'LOCATION_CHANGE', 'Location', bc.locationId || '', locationId, notes || 'Location assigned');
  return { ok: true, barcode: barcode, locationId: locationId, fullPath: location.fullPath };
}

function assignBarcodeLocationBulk(assignments) {
  // assignments = [{ barcode, locationId, notes }]
  const results = [];
  (assignments || []).forEach(function(a) {
    try {
      results.push(assignBarcodeLocation(a.barcode, a.locationId, a.notes));
    } catch(e) {
      results.push({ ok: false, barcode: a.barcode, error: e.message });
    }
  });
  return results;
}

function clearBarcodeLocation(barcode, notes) {
  requireValue_(barcode, 'barcode is required.');
  const bc = getBarcodeByCode(barcode);
  if (!bc) throw new Error('Barcode not found: ' + barcode);

  const sheet   = getSheet_(MAV.SHEETS.BARCODES);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const rowIdx  = data.findIndex(function(r, i) { return i > 0 && String(r[0]) === String(barcode); });
  if (rowIdx === -1) throw new Error('Barcode row not found: ' + barcode);

  const locCol     = headers.indexOf('Location ID');
  const pathCol    = headers.indexOf('Location Path');
  const updatedCol = headers.indexOf('Updated At');

  if (locCol  !== -1) sheet.getRange(rowIdx + 1, locCol  + 1).setValue('');
  if (pathCol !== -1) sheet.getRange(rowIdx + 1, pathCol + 1).setValue('');
  if (updatedCol !== -1) sheet.getRange(rowIdx + 1, updatedCol + 1).setValue(new Date().toISOString());

  writeAuditLog_('Barcode', barcode, 'LOCATION_CLEAR', 'Location', bc.locationPath || '', '', notes || 'Location cleared');
  return { ok: true, barcode: barcode };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────────

function getBarcodesAtLocation(locationId) {
  if (!locationId) return [];
  return readObjects_(MAV.SHEETS.BARCODES)
    .filter(function(r) { return String(r['Location ID']) === String(locationId); })
    .map(mapBarcodeRow_);
}

function getBarcodeLocationHistory(barcode) {
  return readObjects_(MAV.SHEETS.BARCODE_LOCATIONS)
    .filter(function(r) { return String(r['Barcode']) === String(barcode); })
    .map(function(r) {
      return {
        logId:        safeString_(r['Log ID']),
        barcode:      safeString_(r['Barcode']),
        productId:    safeString_(r['Product ID']),
        locationId:   safeString_(r['Location ID']),
        locationPath: safeString_(r['Location Path']),
        movedAt:      safeString_(r['Moved At']),
        movedBy:      safeString_(r['Moved By']),
        notes:        safeString_(r['Notes'])
      };
    })
    .sort(function(a, b) { return new Date(b.movedAt || 0) - new Date(a.movedAt || 0); });
}

function getLocationOccupancy() {
  const locations = getWarehouseLocations({ activeOnly: true });
  const barcodes  = readObjects_(MAV.SHEETS.BARCODES);

  const locMap = {};
  barcodes.forEach(function(r) {
    const lid = safeString_(r['Location ID']);
    if (!lid) return;
    if (!locMap[lid]) locMap[lid] = [];
    locMap[lid].push(safeString_(r['Barcode']));
  });

  return locations.map(function(loc) {
    const items = locMap[loc.locationId] || [];
    return {
      locationId:  loc.locationId,
      fullPath:    loc.fullPath,
      locationType:loc.locationType,
      capacity:    loc.capacity,
      count:       items.length,
      utilPct:     loc.capacity > 0 ? round2_((items.length / loc.capacity) * 100) : null,
      barcodes:    items
    };
  });
}

function getUnlocatedBarcodes() {
  return readObjects_(MAV.SHEETS.BARCODES)
    .filter(function(r) {
      const status = safeString_(r['Status']);
      const locId  = safeString_(r['Location ID']);
      return !locId && status === 'Available';
    })
    .map(mapBarcodeRow_);
}

function getPickList(jobId) {
  // Returns items for a job grouped by warehouse location — for prep packing
  requireValue_(jobId, 'jobId is required.');
  const job = getJobById(jobId);
  if (!job) throw new Error('Job not found: ' + jobId);

  const serialisedLines = (job.items || []).filter(function(i) { return i.stockMethod === ENUMS.STOCK_METHOD.SERIALISED; });
  const bulkLines       = (job.items || []).filter(function(i) { return i.stockMethod === ENUMS.STOCK_METHOD.BULK && i.lineType !== ENUMS.LINE_TYPE.SERVICE; });

  // Serialised: get available barcodes and their locations
  const pickItems = [];

  serialisedLines.forEach(function(line) {
    const barcodes = getBarcodes(line.productId, ENUMS.BARCODE_STATUS.AVAILABLE).slice(0, line.qtyRequired);
    barcodes.forEach(function(bc) {
      pickItems.push({
        lineId:       line.lineId,
        productId:    line.productId,
        sku:          line.sku,
        name:         line.name,
        barcode:      bc.barcode,
        serialNumber: bc.serialNumber,
        locationId:   bc.locationId   || '',
        locationPath: bc.locationPath || 'Unlocated',
        condition:    bc.condition
      });
    });
  });

  bulkLines.forEach(function(line) {
    pickItems.push({
      lineId:       line.lineId,
      productId:    line.productId,
      sku:          line.sku,
      name:         line.name,
      barcode:      '',
      serialNumber: '',
      locationId:   '',
      locationPath: 'Bulk Stock',
      qtyRequired:  line.qtyRequired,
      isBulk:       true
    });
  });

  // Group by location
  const grouped = {};
  pickItems.forEach(function(item) {
    const key = item.locationPath;
    if (!grouped[key]) grouped[key] = { locationPath: key, items: [] };
    grouped[key].items.push(item);
  });

  return {
    jobId:     jobId,
    jobName:   job.jobName,
    startDate: job.startDate || job.eventDate,
    groups:    Object.values(grouped).sort(function(a, b) { return a.locationPath.localeCompare(b.locationPath); }),
    totalItems:pickItems.length
  };
}

// After a job is returned, auto-return barcodes to their last known location
function returnBarcodesToStorage(jobId) {
  requireValue_(jobId, 'jobId is required.');
  const history  = readObjects_(MAV.SHEETS.BARCODE_LOCATIONS);
  const returned = [];

  // Get all barcodes that were checked out to this job
  const jobBarcodes = readObjects_(MAV.SHEETS.JOB_BARCODES)
    .filter(function(r) { return String(r['Job ID']) === String(jobId) && String(r['Scan Type']) === 'RETURN'; })
    .map(function(r) { return safeString_(r['Barcode']); });

  jobBarcodes.forEach(function(barcode) {
    // Find the last location this barcode was at before the job
    const lastLoc = history
      .filter(function(r) { return String(r['Barcode']) === String(barcode); })
      .sort(function(a, b) { return new Date(b['Moved At'] || 0) - new Date(a['Moved At'] || 0); })[0];

    if (lastLoc && safeString_(lastLoc['Location ID'])) {
      try {
        assignBarcodeLocation(barcode, safeString_(lastLoc['Location ID']), 'Auto-returned from job ' + jobId);
        returned.push(barcode);
      } catch(e) {
        Logger.log('returnBarcodesToStorage: ' + barcode + ' — ' + e.message);
      }
    }
  });

  return { ok: true, jobId: jobId, returnedCount: returned.length, barcodes: returned };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAREHOUSE INITIALISATION — seed a standard warehouse structure
// ─────────────────────────────────────────────────────────────────────────────

function seedWarehouseLocations() {
  const existing = readObjects_(MAV.SHEETS.WAREHOUSE_LOCATIONS);
  if (existing.length) return { ok: true, message: 'Warehouse locations already exist.' };

  const created = [];

  function mk(payload) {
    const r = saveWarehouseLocation(payload);
    created.push(r.locationId);
    return r.locationId;
  }

  // Zone A — Audio
  const zA = mk({ zone: 'A', locationType: 'Zone', description: 'Audio Equipment', capacity: 0 });
  const zAB1 = mk({ zone: 'A', bay: '1', locationType: 'Bay', parentId: zA, description: 'Microphones & Wireless', capacity: 0 });
  const zAB1S1 = mk({ zone: 'A', bay: '1', shelf: '1', locationType: 'Shelf', parentId: zAB1, capacity: 20 });
  mk({ zone: 'A', bay: '1', shelf: '1', bin: '1', locationType: 'Bin', parentId: zAB1S1, description: 'Wireless Systems', capacity: 6 });
  mk({ zone: 'A', bay: '1', shelf: '1', bin: '2', locationType: 'Bin', parentId: zAB1S1, description: 'Handheld Mics', capacity: 12 });
  const zAB1S2 = mk({ zone: 'A', bay: '1', shelf: '2', locationType: 'Shelf', parentId: zAB1, capacity: 20 });
  mk({ zone: 'A', bay: '1', shelf: '2', bin: '1', locationType: 'Bin', parentId: zAB1S2, description: 'DI Boxes', capacity: 12 });
  mk({ zone: 'A', bay: '1', shelf: '2', bin: '2', locationType: 'Bin', parentId: zAB1S2, description: 'Accessories / Cables', capacity: 20 });

  const zAB2 = mk({ zone: 'A', bay: '2', locationType: 'Bay', parentId: zA, description: 'PA & Mixers', capacity: 0 });
  const zAB2S1 = mk({ zone: 'A', bay: '2', shelf: '1', locationType: 'Shelf', parentId: zAB2, capacity: 8 });
  mk({ zone: 'A', bay: '2', shelf: '1', bin: '1', locationType: 'Bin', parentId: zAB2S1, description: 'PA Speakers', capacity: 8 });
  const zAB2S2 = mk({ zone: 'A', bay: '2', shelf: '2', locationType: 'Shelf', parentId: zAB2, capacity: 4 });
  mk({ zone: 'A', bay: '2', shelf: '2', bin: '1', locationType: 'Bin', parentId: zAB2S2, description: 'Subwoofers', capacity: 4 });
  mk({ zone: 'A', bay: '2', shelf: '2', bin: '2', locationType: 'Bin', parentId: zAB2S2, description: 'Digital Mixers', capacity: 4 });

  // Zone B — Lighting
  const zB = mk({ zone: 'B', locationType: 'Zone', description: 'Lighting Equipment', capacity: 0 });
  const zBB1 = mk({ zone: 'B', bay: '1', locationType: 'Bay', parentId: zB, description: 'Moving Heads', capacity: 0 });
  const zBB1S1 = mk({ zone: 'B', bay: '1', shelf: '1', locationType: 'Shelf', parentId: zBB1, capacity: 8 });
  mk({ zone: 'B', bay: '1', shelf: '1', bin: '1', locationType: 'Bin', parentId: zBB1S1, description: 'Robe BMFL', capacity: 4 });
  mk({ zone: 'B', bay: '1', shelf: '1', bin: '2', locationType: 'Bin', parentId: zBB1S1, description: 'Chauvet Wash', capacity: 8 });
  const zBB1S2 = mk({ zone: 'B', bay: '1', shelf: '2', locationType: 'Shelf', parentId: zBB1, capacity: 12 });
  mk({ zone: 'B', bay: '1', shelf: '2', bin: '1', locationType: 'Bin', parentId: zBB1S2, description: 'LED PAR Cans', capacity: 20 });
  mk({ zone: 'B', bay: '1', shelf: '2', bin: '2', locationType: 'Bin', parentId: zBB1S2, description: 'Hazers / Atmospherics', capacity: 4 });
  const zBB2 = mk({ zone: 'B', bay: '2', locationType: 'Bay', parentId: zB, description: 'Control & Power', capacity: 0 });
  const zBB2S1 = mk({ zone: 'B', bay: '2', shelf: '1', locationType: 'Shelf', parentId: zBB2, capacity: 6 });
  mk({ zone: 'B', bay: '2', shelf: '1', bin: '1', locationType: 'Bin', parentId: zBB2S1, description: 'DMX Consoles', capacity: 2 });
  mk({ zone: 'B', bay: '2', shelf: '1', bin: '2', locationType: 'Bin', parentId: zBB2S1, description: 'DMX Cables / Splitters', capacity: 20 });

  // Zone C — Rigging & Staging
  const zC = mk({ zone: 'C', locationType: 'Zone', description: 'Rigging, Truss & Staging', capacity: 0 });
  const zCB1 = mk({ zone: 'C', bay: '1', locationType: 'Bay', parentId: zC, description: 'Truss', capacity: 0 });
  const zCB1S1 = mk({ zone: 'C', bay: '1', shelf: '1', locationType: 'Shelf', parentId: zCB1, capacity: 40 });
  mk({ zone: 'C', bay: '1', shelf: '1', bin: '1', locationType: 'Bin', parentId: zCB1S1, description: 'F34 2m Sections', capacity: 20 });
  mk({ zone: 'C', bay: '1', shelf: '1', bin: '2', locationType: 'Bin', parentId: zCB1S1, description: 'Corner Blocks', capacity: 20 });
  const zCB2 = mk({ zone: 'C', bay: '2', locationType: 'Bay', parentId: zC, description: 'Stage Decks & Stands', capacity: 0 });
  const zCB2S1 = mk({ zone: 'C', bay: '2', shelf: '1', locationType: 'Shelf', parentId: zCB2, capacity: 20 });
  mk({ zone: 'C', bay: '2', shelf: '1', bin: '1', locationType: 'Bin', parentId: zCB2S1, description: 'Stage Deck Panels', capacity: 20 });
  mk({ zone: 'C', bay: '2', shelf: '1', bin: '2', locationType: 'Bin', parentId: zCB2S1, description: 'Speaker Stands', capacity: 12 });

  return { ok: true, message: 'Warehouse seeded: Zones A (Audio), B (Lighting), C (Rigging). ' + created.length + ' locations created.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPPER
// ─────────────────────────────────────────────────────────────────────────────

function mapWarehouseLocationRow_(r) {
  return {
    locationId:     safeString_(r['Location ID']),
    locationType:   safeString_(r['Location Type']),
    parentId:       safeString_(r['Parent ID']),
    zone:           safeString_(r['Zone']),
    bay:            safeString_(r['Bay']),
    shelf:          safeString_(r['Shelf']),
    bin:            safeString_(r['Bin']),
    fullPath:       safeString_(r['Full Path']),
    description:    safeString_(r['Description']),
    capacity:       toNumber_(r['Capacity'], 0),
    active:         safeString_(r['Active']) !== 'false',
    createdAt:      safeString_(r['Created At']),
    updatedAt:      safeString_(r['Updated At']),
    layoutX:        toNumber_(r['Layout X'], 0),
    layoutY:        toNumber_(r['Layout Y'], 0),
    layoutW:        toNumber_(r['Layout W'], 1),
    layoutD:        toNumber_(r['Layout D'], 1),
    layoutH:        toNumber_(r['Layout H'], 2.4),
    layoutShelves:  toNumber_(r['Layout Shelves'], 4),
    layoutColor:    safeString_(r['Layout Color'] || '#4db8ff'),
    layoutRotation: toNumber_(r['Layout Rotation'], 0),
  };
}

function buildLocationPath_(payload) {
  const parts = [safeString_(payload.zone)];
  if (payload.bay)   parts.push('Bay ' + safeString_(payload.bay));
  if (payload.shelf) parts.push('Shelf ' + safeString_(payload.shelf));
  if (payload.bin)   parts.push('Bin ' + safeString_(payload.bin));
  return parts.join(' / ');
}

// ── Warehouse designer ────────────────────────────────────────────────────────

// Save entire floor plan layout in one batch call
function saveWarehouseLayout(items) {
  items = items || [];
  var results = [];
  items.forEach(function(item) {
    try {
      var r = saveWarehouseLocation(item);
      results.push(r);
    } catch(e) {
      results.push({ ok: false, error: e.message, item: item.locationId });
    }
  });
  bustSheetCache_(MAV.SHEETS.WAREHOUSE_LOCATIONS);
  return { ok: true, saved: results.filter(function(r){return r.ok;}).length, results: results };
}

// Get warehouse config (dimensions etc) from settings
function getWarehouseConfig() {
  var settings = getSettings();
  return {
    floorW:  parseFloat(settings.warehouseFloorW)  || 20,
    floorD:  parseFloat(settings.warehouseFloorD)  || 15,
    floorH:  parseFloat(settings.warehouseFloorH)  || 6,
    gridSize: parseFloat(settings.warehouseGrid)   || 0.5,
    name:    settings.warehouseName || 'Main Warehouse',
  };
}

function saveWarehouseConfig(config) {
  return saveSettings({
    warehouseFloorW: String(config.floorW  || 20),
    warehouseFloorD: String(config.floorD  || 15),
    warehouseFloorH: String(config.floorH  || 6),
    warehouseGrid:   String(config.gridSize|| 0.5),
    warehouseName:   String(config.name    || 'Main Warehouse'),
  });
}

// ── Get barcodes assigned to a specific location ──────────────────────────────
function getBarcodesByLocation(locationId) {
  if (!locationId) return [];
  // Try BARCODE_LOCATIONS sheet first
  try {
    var locSheet = getSheet_(MAV.SHEETS.BARCODE_LOCATIONS || 'BarcodeLocations');
    var locData  = locSheet.getDataRange().getValues();
    var barcodes = [];
    for (var i = 1; i < locData.length; i++) {
      var row = locData[i];
      var bc  = String(row[0] || '');
      var loc = String(row[1] || '');
      if (!bc) continue;
      if (loc === locationId || String(row[2] || '') === locationId) {
        barcodes.push(bc);
      }
    }
    // Look up product info for each barcode
    return barcodes.map(function(bc) {
      var info = getBarcodeByCode(bc);
      return {
        barcode:     bc,
        productId:   info ? info.productId : '',
        productName: info ? info.productName : '',
        serialNumber:info ? info.serialNumber : '',
        condition:   info ? info.condition : '',
      };
    });
  } catch(e) {
    // Fallback: search barcodes sheet for matching location
    var barcodeSheet = getSheet_(MAV.SHEETS.BARCODES);
    var data = barcodeSheet.getDataRange().getValues();
    var results = [];
    for (var j = 1; j < data.length; j++) {
      var row = data[j];
      if (String(row[4] || '') === locationId || String(row[3] || '') === locationId) {
        results.push({
          barcode:     String(row[0] || ''),
          productId:   String(row[1] || ''),
          productName: String(row[2] || ''),
          serialNumber:String(row[3] || ''),
          condition:   String(row[5] || ''),
        });
      }
    }
    return results;
  }
}