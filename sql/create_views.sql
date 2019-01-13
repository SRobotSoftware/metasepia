CREATE VIEW sessions_view
AS select
sessions.session_id,
sessions.streamer,
sessions.activity,
sessions.start_timestamp,
sessions.end_timestamp,
activity_types.activity_type
from
sessions
left join activities_mapping on sessions.fk_activities_mapping = activities_mapping.activities_mapping_id
left join activity_types on activities_mapping.fk_activity_types = activity_types.activity_types_id
ORDER BY sessions.session_id DESC;
