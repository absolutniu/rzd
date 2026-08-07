-- ============================================================================
-- RZD.md -> SQLite schema
-- Источник: D:\Projects\claude\RZD\RZD.md (выгрузка из Excel, справочник вагонов,
--           вагоностроительных заводов, тележек, ремонтных депо и грузов)
-- Не перенесены как отдельные таблицы:
--   "Справочник_ID" - это легенда префиксов ID (документация, не данные)
--   "Лист2"         - черновой дублирующий лист без собственной структуры
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ========================================================================
-- Справочники вагонов
-- ========================================================================

CREATE TABLE vagon_types ( -- Типы_вагонов
  id   TEXT PRIMARY KEY,   -- T001
  name TEXT NOT NULL
);

CREATE TABLE vagon_kinds ( -- Род_вагонов (подтип внутри типа, напр. "с разгрузочными люками")
  id            TEXT PRIMARY KEY,  -- ST001
  vagon_type_id TEXT NOT NULL REFERENCES vagon_types(id),
  name          TEXT NOT NULL
);

CREATE TABLE container_sizes ( -- Размеры_контейнеров
  id   TEXT PRIMARY KEY,  -- CT001
  name TEXT NOT NULL
);

-- ========================================================================
-- Вагоностроительные заводы
-- ========================================================================

CREATE TABLE manufacturer_departments ( -- ВСЗ_Подраздел конт (разделы карточки контактов завода)
  id         TEXT PRIMARY KEY,  -- DEP001
  name       TEXT NOT NULL,
  sort_order INTEGER
);

CREATE TABLE manufacturers ( -- ID вагоностр. произ (+ иерархия из ВСЗ_Структур -> parent_id)
  id                    TEXT PRIMARY KEY,  -- M100
  parent_id             TEXT REFERENCES manufacturers(id),  -- головное предприятие (если это филиал)
  full_name             TEXT NOT NULL,
  short_name            TEXT,
  country               TEXT,
  region                TEXT,
  city                  TEXT,
  enterprise_type       TEXT,
  produces_25tf_vagons  TEXT,  -- да/нет/NULL как в источнике ("Компетенции по производству вагонов 25 тс")
  website               TEXT,
  telegram_1            TEXT,
  telegram_2            TEXT,
  telegram_3            TEXT
);

CREATE TABLE manufacturer_vagon_types ( -- ВСЗ_Типы ваг (какие типы вагонов выпускает завод)
  manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
  vagon_type_id   TEXT NOT NULL REFERENCES vagon_types(id),
  PRIMARY KEY (manufacturer_id, vagon_type_id)
);

CREATE TABLE manufacturer_capacity ( -- ВСЗ_Показат
  manufacturer_id                 TEXT PRIMARY KEY REFERENCES manufacturers(id),
  capacity_thousand_vagons_year   REAL,
  staff_thousand                  REAL,
  data_year                       INTEGER
);

CREATE TABLE manufacturer_output ( -- ВСЗ_Выпуск (динамика производства по годам)
  manufacturer_id         TEXT NOT NULL REFERENCES manufacturers(id),
  year                    INTEGER NOT NULL,
  volume_thousand_vagons  REAL,
  share_percent           REAL,
  PRIMARY KEY (manufacturer_id, year)
);

CREATE TABLE manufacturer_contacts ( -- ВСЗ_Контакты
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  manufacturer_id             TEXT NOT NULL REFERENCES manufacturers(id),
  department_id               TEXT REFERENCES manufacturer_departments(id),
  contact_name                TEXT,
  phone                       TEXT,
  email                       TEXT,
  is_primary_for_vagon_card   TEXT
);

-- ========================================================================
-- Вагоны и тележки
-- ========================================================================

CREATE TABLE vagons ( -- ID вагоны_общ
  id                          TEXT PRIMARY KEY,  -- W001
  vagon_type_id               TEXT NOT NULL REFERENCES vagon_types(id),
  vagon_kind_id                TEXT REFERENCES vagon_kinds(id),
  model                        TEXT,
  model_note                   TEXT,
  manufacturer_id              TEXT REFERENCES manufacturers(id),
  kd_number                    TEXT,  -- номер конструкторской документации
  accounting_specialization    TEXT,
  europallet_count              INTEGER,
  requires_authorization       TEXT   -- да/нет
);

CREATE TABLE bogies ( -- ID тележки_общ
  id              TEXT PRIMARY KEY,  -- B001
  model           TEXT NOT NULL,
  model_note      TEXT,
  manufacturer_id TEXT REFERENCES manufacturers(id),
  axle_load_tf    REAL,
  axle_load_kn    REAL
);

CREATE TABLE vagon_bogies ( -- Вагон-Тележка
  vagon_id TEXT NOT NULL REFERENCES vagons(id),
  bogie_id TEXT NOT NULL REFERENCES bogies(id),
  PRIMARY KEY (vagon_id, bogie_id)
);

-- ========================================================================
-- Характеристики по типам вагона (1:1 с vagons; разные наборы полей у каждого типа,
-- как и было в исходном Excel - отдельный лист характеристик на тип вагона)
-- ========================================================================

CREATE TABLE gondola_char ( -- Полувагон_Характер (T001)
  vagon_id            TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t          REAL,
  body_volume_m3      REAL,
  tare_mass_t         REAL,
  length_mm           INTEGER,
  service_life_years  INTEGER,
  gauge               TEXT
);

CREATE TABLE tank_char ( -- Цистерны_Характер (T002)
  vagon_id                   TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t                 REAL,
  boiler_volume_m3           REAL,
  tare_mass_t                REAL,
  boiler_inner_diameter_mm   INTEGER,
  length_mm                  INTEGER,
  service_life_years         INTEGER,
  gauge                      TEXT
);

CREATE TABLE hopper_char ( -- Хопперы_Характер (T003)
  vagon_id                TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t              REAL,
  body_volume_m3          REAL,
  tare_mass_t             REAL,
  length_mm               INTEGER,
  loading_hatches_count   INTEGER,
  unloading_hatches_count INTEGER,
  service_life_years      INTEGER,
  gauge                   TEXT
);

CREATE TABLE fitting_platform_char ( -- Фитин платф_Характер (T004 / фитинговая)
  vagon_id           TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t         REAL,
  length_mm          INTEGER,
  frame_length_mm    INTEGER,
  base_mm            INTEGER,
  width_mm           INTEGER,
  fittings_total     INTEGER,
  fittings_folding   INTEGER,
  tare_mass_t        REAL,
  service_life_years INTEGER,
  gauge              TEXT
);

CREATE TABLE timber_platform_char ( -- Лесовоз платф_Характер (T004 / для леса)
  vagon_id           TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t         REAL,
  body_volume_m3     REAL,
  length_mm          INTEGER,
  frame_length_mm    INTEGER,
  base_mm            INTEGER,
  width_mm           INTEGER,
  stanchions_count   INTEGER,
  fittings_total     INTEGER,
  tare_mass_t        REAL,
  service_life_years INTEGER,
  gauge              TEXT
);

CREATE TABLE universal_platform_char ( -- Универс платф_Характер (T004 / универсальная)
  vagon_id           TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t         REAL,
  frame_length_mm    INTEGER,
  width_mm           INTEGER,
  base_mm            INTEGER,
  floor_area_m2      REAL,
  tare_mass_t        REAL,
  length_mm          INTEGER,
  service_life_years INTEGER,
  gauge              TEXT
);

CREATE TABLE rolled_metal_platform_char ( -- Платф для прокат_Характер (T004 / для проката)
  vagon_id           TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t         REAL,
  frame_length_mm    INTEGER,
  width_mm           INTEGER,
  base_mm            INTEGER,
  tare_mass_t        REAL,
  length_mm          INTEGER,
  service_life_years INTEGER,
  gauge              TEXT
);

CREATE TABLE other_platform_char ( -- Проч платф_Характер (T004 / прочие)
  vagon_id           TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t         REAL,
  frame_length_mm    INTEGER,
  width_mm           INTEGER,
  base_mm            INTEGER,
  stanchions_count   INTEGER,
  end_walls          TEXT,
  fittings_total     INTEGER,
  tare_mass_t        REAL,
  length_mm          INTEGER,
  service_life_years INTEGER,
  gauge              TEXT
);

CREATE TABLE covered_wagon_char ( -- Крыт ваг_Характер (T005)
  vagon_id               TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t             REAL,
  body_volume_m3         REAL,
  floor_area_m2          REAL,
  door_opening_width_mm  INTEGER,
  door_opening_height_mm INTEGER,
  inner_length_mm        INTEGER,
  inner_width_mm         INTEGER,
  inner_height_mm        INTEGER,
  tare_mass_t            REAL,
  fittings_total         INTEGER,
  length_mm              INTEGER,
  service_life_years     INTEGER,
  gauge                  TEXT
);

CREATE TABLE reefer_char ( -- Изотермы_Характер (T006)
  vagon_id                 TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t               REAL,
  body_volume_m3           REAL,
  floor_area_m2            REAL,
  inner_length_mm          INTEGER,
  inner_width_mm           INTEGER,
  inner_height_mm          INTEGER,
  tare_mass_t              REAL,
  length_mm                INTEGER,
  temp_range_c              TEXT,
  heat_transfer_coef        REAL,
  transport_duration_days   REAL,
  service_life_years        INTEGER,
  gauge                     TEXT
);

CREATE TABLE dump_car_char ( -- Самосвалы_Характер (T007, думпкар)
  vagon_id           TEXT PRIMARY KEY REFERENCES vagons(id),
  capacity_t         REAL,
  body_volume_m3     REAL,
  width_mm           INTEGER,
  base_mm            INTEGER,
  tare_mass_t        REAL,
  length_mm          INTEGER,
  axles_count        INTEGER,
  service_life_years INTEGER,
  gauge              TEXT
);

-- ========================================================================
-- Межремонтные сроки, сертификаты, особенности конструкции
-- ========================================================================

CREATE TABLE vagon_overhaul_intervals ( -- Межремонт сроки - Вагон
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  vagon_id                    TEXT NOT NULL REFERENCES vagons(id),
  criterion                   TEXT NOT NULL,  -- Единичный / Комбинированный
  dr_after_build_years        REAL,
  dr_after_build_km_thousand  REAL,
  dr_after_dr_years           REAL,
  dr_after_dr_km_thousand     REAL,
  dr_after_kr_years           REAL,
  dr_after_kr_km_thousand     REAL,
  kr_after_build_years        REAL,
  kr_after_kr_years           REAL
);

CREATE TABLE certificates ( -- Сертификаты-Вагоны
  id           TEXT PRIMARY KEY,  -- S001
  vagon_id     TEXT NOT NULL REFERENCES vagons(id),
  cert_number  TEXT,
  valid_from   TEXT,  -- ISO date (YYYY-MM-DD)
  valid_to     TEXT,
  status       TEXT
);

CREATE TABLE vagon_features ( -- ID особенности
  id   TEXT PRIMARY KEY,  -- F001
  name TEXT NOT NULL
);

CREATE TABLE vagon_feature_links ( -- Особенн-Вагон
  vagon_id   TEXT NOT NULL REFERENCES vagons(id),
  feature_id TEXT NOT NULL REFERENCES vagon_features(id),
  PRIMARY KEY (vagon_id, feature_id)
);

CREATE TABLE platform_containers ( -- Платформ-Контейнер (какие контейнеры возит платформа)
  vagon_id           TEXT NOT NULL REFERENCES vagons(id),
  container_size_id  TEXT NOT NULL REFERENCES container_sizes(id),
  PRIMARY KEY (vagon_id, container_size_id)
);

-- ========================================================================
-- Грузы
-- ========================================================================

CREATE TABLE cargo_types ( -- ID грузов
  id          TEXT PRIMARY KEY,  -- C001
  etsng_code  TEXT,              -- код ЕТСНГ
  name        TEXT NOT NULL
);

CREATE TABLE vagon_cargo ( -- Вагон - груз (какие грузы возит вагон)
  vagon_id TEXT NOT NULL REFERENCES vagons(id),
  cargo_id TEXT NOT NULL REFERENCES cargo_types(id),
  PRIMARY KEY (vagon_id, cargo_id)
);

-- ========================================================================
-- Ремонт: холдинги, депо
-- ========================================================================

CREATE TABLE repair_holdings ( -- Ремонт Холдинг
  id               TEXT PRIMARY KEY,  -- RH001
  full_name        TEXT NOT NULL,
  short_name       TEXT,
  country          TEXT,
  enterprise_type  TEXT,
  website          TEXT,
  telegram         TEXT
);

CREATE TABLE railways ( -- ID желез дорог
  id   TEXT PRIMARY KEY,  -- RW001
  name TEXT NOT NULL
);

CREATE TABLE repair_types ( -- ID ремонтов
  id   TEXT PRIMARY KEY,  -- RT001
  name TEXT NOT NULL
);

CREATE TABLE repair_holding_contacts ( -- Ремонт холд-Контакты
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  holding_id   TEXT NOT NULL REFERENCES repair_holdings(id),
  contact_name TEXT,
  phone        TEXT,
  email        TEXT
);

CREATE TABLE depots ( -- Депо_Характер
  id                TEXT PRIMARY KEY,  -- D001
  holding_id        TEXT REFERENCES repair_holdings(id),
  name              TEXT NOT NULL,
  stamp_code        TEXT,
  railway_id        TEXT REFERENCES railways(id),
  adjoining_station TEXT,
  station_code      TEXT,
  latitude          REAL,
  longitude         REAL,
  website           TEXT
);

CREATE TABLE depot_competencies ( -- Депо_Компетенц (какой вид ремонта каких вагонов делает депо)
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  depot_id        TEXT NOT NULL REFERENCES depots(id),
  repair_type_id  TEXT NOT NULL REFERENCES repair_types(id),
  vagon_type_id   TEXT NOT NULL REFERENCES vagon_types(id),
  vagon_kind_id   TEXT REFERENCES vagon_kinds(id),
  note            TEXT
);

CREATE TABLE depot_authorizations ( -- Депо_Авторизац (депо авторизовано на ремонт конкретной модели вагона)
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  depot_id       TEXT NOT NULL REFERENCES depots(id),
  repair_type_id TEXT NOT NULL REFERENCES repair_types(id),
  vagon_id       TEXT NOT NULL REFERENCES vagons(id)
);

CREATE TABLE depot_services ( -- ID услуги депо (в источнике пока нет строк)
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE depot_service_links ( -- Услуги-Депо (в источнике пока нет строк)
  depot_id   TEXT NOT NULL REFERENCES depots(id),
  service_id TEXT NOT NULL REFERENCES depot_services(id),
  PRIMARY KEY (depot_id, service_id)
);

CREATE TABLE depot_contacts ( -- Депо-Контакты (в источнике пока нет строк)
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  depot_id     TEXT NOT NULL REFERENCES depots(id),
  contact_name TEXT,
  phone        TEXT,
  email        TEXT
);

-- ========================================================================
-- Комплектующие тележки
-- ========================================================================

CREATE TABLE component_types ( -- ID комплект (тип)
  id   TEXT PRIMARY KEY,  -- Z001
  name TEXT NOT NULL
);

CREATE TABLE bogie_components ( -- Тележ-Комплект
  id                 TEXT PRIMARY KEY,  -- X001
  bogie_id           TEXT NOT NULL REFERENCES bogies(id),
  component_type_id  TEXT NOT NULL REFERENCES component_types(id),
  name               TEXT,
  drawing_number     TEXT
);

CREATE TABLE bogie_drawings ( -- Тележка-чертеж
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bogie_id       TEXT NOT NULL REFERENCES bogies(id),
  drawing_number TEXT NOT NULL
);

-- ========================================================================
-- Индексы для внешних ключей (SQLite не индексирует FK-колонки автоматически)
-- ========================================================================

CREATE INDEX idx_vagon_kinds_type            ON vagon_kinds(vagon_type_id);
CREATE INDEX idx_manufacturers_parent        ON manufacturers(parent_id);
CREATE INDEX idx_manufacturer_vagon_types_vt ON manufacturer_vagon_types(vagon_type_id);
CREATE INDEX idx_manufacturer_output_year    ON manufacturer_output(year);
CREATE INDEX idx_manufacturer_contacts_mfr   ON manufacturer_contacts(manufacturer_id);
CREATE INDEX idx_vagons_type                 ON vagons(vagon_type_id);
CREATE INDEX idx_vagons_kind                 ON vagons(vagon_kind_id);
CREATE INDEX idx_vagons_manufacturer         ON vagons(manufacturer_id);
CREATE INDEX idx_bogies_manufacturer         ON bogies(manufacturer_id);
CREATE INDEX idx_vagon_bogies_bogie          ON vagon_bogies(bogie_id);
CREATE INDEX idx_overhaul_vagon              ON vagon_overhaul_intervals(vagon_id);
CREATE INDEX idx_certificates_vagon          ON certificates(vagon_id);
CREATE INDEX idx_feature_links_feature       ON vagon_feature_links(feature_id);
CREATE INDEX idx_platform_containers_cont    ON platform_containers(container_size_id);
CREATE INDEX idx_vagon_cargo_cargo           ON vagon_cargo(cargo_id);
CREATE INDEX idx_repair_holding_contacts_h   ON repair_holding_contacts(holding_id);
CREATE INDEX idx_depots_holding              ON depots(holding_id);
CREATE INDEX idx_depots_railway              ON depots(railway_id);
CREATE INDEX idx_depot_competencies_depot    ON depot_competencies(depot_id);
CREATE INDEX idx_depot_competencies_vt       ON depot_competencies(vagon_type_id);
CREATE INDEX idx_depot_authorizations_depot  ON depot_authorizations(depot_id);
CREATE INDEX idx_depot_authorizations_vagon  ON depot_authorizations(vagon_id);
CREATE INDEX idx_depot_contacts_depot        ON depot_contacts(depot_id);
CREATE INDEX idx_bogie_components_bogie      ON bogie_components(bogie_id);
CREATE INDEX idx_bogie_components_type       ON bogie_components(component_type_id);
CREATE INDEX idx_bogie_drawings_bogie        ON bogie_drawings(bogie_id);
