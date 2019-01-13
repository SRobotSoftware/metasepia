DELIMITER //
CREATE PROCEDURE `newSession`(
  IN streamer_in VARCHAR(256),
  IN activity_in VARCHAR(256),
  IN start_timestamp_in INT,
  IN raw_topic_string_in VARCHAR(512),
  IN activity_raw_in VARCHAR(16))
BEGIN

  DECLARE activity_id_returned INT;

  SELECT activities_mapping_id
  INTO activity_id_returned
  FROM activities_mapping
  WHERE activity_raw = activity_raw_in;

  IF ISNULL(activity_id_returned)
  THEN -- INSERT
    INSERT INTO activities_mapping(activity_raw)
    VALUES (activity_raw_in);
    INSERT INTO sessions(streamer, activity, start_timestamp, raw_topic_string, fk_activities_mapping)
    VALUES (streamer_in, activity_in, start_timestamp_in, raw_topic_string_in, LAST_INSERT_ID());
  ELSE -- USE RETURNED VALUE
    INSERT INTO sessions(streamer, activity, start_timestamp, raw_topic_string, fk_activities_mapping)
    VALUES (streamer_in, activity_in, start_timestamp_in, raw_topic_string_in, activity_id_returned);
  END IF;

END //
DELIMITER;
