-- This is a query to output totalPlayed data

drop temporary table if exists totalgames;
create temporary table totalgames (primary key(session_id)) as
select session_id, streamer, start_timestamp, end_timestamp, duration_in_seconds from sessions_view where activity like '%dark souls%';
select start_timestamp into @st from totalgames order by session_id asc limit 1;
select end_timestamp into @en from totalgames order by session_id desc limit 1;
select streamer into @str from totalgames order by session_id desc limit 1;
select sum(duration_in_seconds) into @dur from totalgames;
select @st as start_timestamp, @en as end_timestamp, @str as streamer, @dur as duration_in_seconds;
