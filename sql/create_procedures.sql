DELIMITER //
CREATE PROCEDURE `endSession`()
BEGIN

  UPDATE sessions
  SET end_timestamp = CURRENT_TIMESTAMP
  WHERE ISNULL(end_timestamp);

END//

DELIMITER //
CREATE PROCEDURE `newSession`(
  IN streamer_in VARCHAR(256),
  IN activity_in VARCHAR(256),
  IN raw_topic_string_in VARCHAR(512),
  IN activity_raw_in VARCHAR(16))
BEGIN

  DECLARE activity_id_returned INT;

  CALL endSession();

  SELECT activities_mapping_id
  INTO activity_id_returned
  FROM activities_mapping
  WHERE activity_raw = activity_raw_in;

  IF ISNULL(activity_id_returned)
  THEN -- INSERT
    INSERT INTO activities_mapping(activity_raw)
    VALUES (activity_raw_in);
    INSERT INTO sessions(streamer, activity, raw_topic_string, fk_activities_mapping)
    VALUES (streamer_in, activity_in, raw_topic_string_in, LAST_INSERT_ID());
  ELSE -- USE RETURNED VALUE
    INSERT INTO sessions(streamer, activity, raw_topic_string, fk_activities_mapping)
    VALUES (streamer_in, activity_in, raw_topic_string_in, activity_id_returned);
  END IF;

  SELECT LAST_INSERT_ID() AS `session_id`;

END //

DELIMITER //
CREATE PROCEDURE `totalSession`(
  IN activity_in VARCHAR(255),
  IN streamer_in VARCHAR(255)
)
BEGIN

  declare end_t TIMESTAMP;
  declare start_t TIMESTAMP;
  declare duration INT;

  select end_timestamp into end_t from sessions_view
  where
  activity like activity_in
  and streamer like streamer_in
  and not ISNULL(end_timestamp)
  limit 1;

  select start_timestamp into start_t from sessions_view
  where
  activity like activity_in
  and streamer like streamer_in
  order by session_id asc
  limit 1;

  select SUM(duration_in_seconds) into duration from sessions_view
  where
  activity like activity_in
  and streamer like streamer_in;

  select start_t, end_t, duration;

END //


DELIMITER //
CREATE PROCEDURE `countUnmappedActivities`()
BEGIN

  select COUNT(activity_raw) as `Unmapped Activities Count` from activities_mapping where ISNULL(fk_activity_types);

END //
