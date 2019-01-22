ALTER VIEW sessions_view AS SELECT
MAX(s.session_id) AS session_id,
s.streamer,
s.activity,
MIN(s.start_timestamp) AS start_timestamp,
MAX(s.end_timestamp) AS end_timestamp,
(UNIX_TIMESTAMP(MAX(s.end_timestamp)) - UNIX_TIMESTAMP(MIN(s.start_timestamp))) AS `duration_in_seconds`,
act.activity_type,
FLOOR(UNIX_TIMESTAMP(s.start_timestamp) / 86400) AS `day`
FROM
sessions AS s
LEFT JOIN activities_mapping ON s.fk_activities_mapping = activities_mapping.activities_mapping_id
LEFT JOIN activity_types AS act ON activities_mapping.fk_activity_types = act.activity_types_id
GROUP BY streamer, activity, activity_type, `day`
ORDER BY session_id DESC;
