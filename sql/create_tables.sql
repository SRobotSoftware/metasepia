CREATE TABLE `activity_types` (
  `activity_types_id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_type` varchar(16) NOT NULL,
  PRIMARY KEY (`activity_types_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8;

CREATE TABLE `activities_mapping` (
  `activities_mapping_id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_raw` varchar(16) NOT NULL,
  `fk_activity_types` int(11) DEFAULT NULL,
  PRIMARY KEY (`activities_mapping_id`),
  KEY `fk_activity_types` (`fk_activity_types`),
  CONSTRAINT `activities_mapping_ibfk_1`
    FOREIGN KEY (`fk_activity_types`)
    REFERENCES `activity_types` (`activity_types_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8;

CREATE TABLE `sessions` (
  `session_id` int(11) NOT NULL AUTO_INCREMENT,
  `streamer` varchar(256) NOT NULL,
  `activity` varchar(256) NOT NULL,
  `start_timestamp` int(10) unsigned NOT NULL,
  `end_timestamp` int(10) unsigned DEFAULT NULL,
  `raw_topic_string` varchar(512) NOT NULL,
  `fk_activities_mapping` int(11) DEFAULT NULL,
  PRIMARY KEY (`session_id`),
  KEY `fk_activities_mapping` (`fk_activities_mapping`),
  CONSTRAINT `sessions_ibfk_1`
    FOREIGN KEY (`fk_activities_mapping`)
    REFERENCES `activities_mapping` (`activities_mapping_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8;
