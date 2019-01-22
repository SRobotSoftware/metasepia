/*
**  Requires
*/

const Irc = require('irc')
const Pino = require('pino')
const config = require('config')
const knex = require('knex')
const moment = require('moment')

/*
**  Config
*/

const pinoConfig = config.get('pinoConfig')
const ircConfig = config.get('irc')
const dbConfig = config.get('dbConfig')
const {
  streamerAliases,
  topicTrackingChannels,
  silentChannels,
  commandPrefix,
} = config.get('meta')

/*
**  Initialization
*/

const log = Pino(pinoConfig)
const client = new Irc.Client(ircConfig.server, ircConfig.name, ircConfig.config)
const db = knex(dbConfig)

// Killswitch for when things get hung up, ctrl+c twice to hit it
let forceKill = false

/*
**  Functions
*/

const leftPad = (str, amount = 2) => {
  str = str + ''
  const out = [...str]
  while (out.length < amount) {
    out.unshift(0)
  }
  return out.join('')
}

const parseTopic = (channel, topic, nick, message) => {
  // Short circuit if we get a topic message from a channel we don't care about
  if (!topicTrackingChannels.some(x => x === channel)) return null
  // Short circuit if we get a topic message from a source OTHER than a user
  if (message.command !== 'TOPIC') return null

  log.info('Topic Change Detected:', topic)

  const streamers = getStreamers(topic)
  const activityType = getActivityType(topic)
  const activity = getActivity(activityType, topic)

  if (streamers && activity)
    startSession(streamers, activityType, activity, topic)
  else
    endSession()
}

const startSession = (streamers, activityType, activity, topicString) => {
  log.debug({
    session: {
      streamers,
      activityType,
      activity,
      topicString,
    }
  }, 'Starting session')
  // Don't worry about calling endSession first
  // newSession will automatically close any previous sessions
  db.raw('call newSession(?, ?, ?, ?)', [streamers, activity, topicString, activityType])
    .then(res => {
      const sessionId = res[0][0].session_id
      log.debug({ sessionId }, 'Session successfully started')
    })
    .catch(err => {
      log.error(err)
    })
}

const endSession = () => {
  log.debug('Ending session')
  db.raw('call endSession()')
    .then(res => log.debug({ results: res }, 'Session successfully ended'))
    .catch(err => log.error(err))
}

const getStreamers = str => {
  log.debug('Getting Streamers...')
  const streamers = /streamers?:(?:\s*)(.*?)(?:\s*)\|/i.exec(str)
  log.debug({ streamers }, 'STREAMERS RESULT')
  return streamers[1].toLowerCase()
}

const getActivityType = str => {
  log.debug('Getting Activity Type...')
  const activityType = /\|(?:\s*)(\S+)(?:\s*):/.exec(str)
  log.debug({ activityType }, 'ACTIVITY TYPE RESULT')
  return activityType[1].toLowerCase()
}

const getActivity = (type, str) => {
  log.debug('Getting Activity...')
  const activity = (new RegExp(`${type}:(?:\\s*)(.*?)(?:\\s*)(?:\\||$)`, 'i')).exec(str)
  log.debug({ activity }, 'ACTIVITY RESULT')
  return activity[1].toLowerCase()
}

const parseMessage = (from, to, message) => {
  log.debug(from, to, message)
  const parsedCommand = (new RegExp(`^${commandPrefix}(\\S*)`)).exec(message)
  const command = parsedCommand ? parsedCommand[1].toLowerCase() : ''
  if ((to[0] === '#' || to === ircConfig.name) && command) {
    if (to === ircConfig.name) to = from
    if (commands.hasOwnProperty(command)) {
      log.debug({ command }, `Command parsed: ${command}`)
      commands[command](from, to, message)
    } else
      log.debug({ command }, `Unrecognized Command given: ${command}`)
  }
}

const linkDiscord = (from, to) => {
  send(to, `${from}: https://discord.gg/R7cazz8`)
}

const linkOnDemand = (from, to) => {
  send(to, `${from}: http://vacker.tv/ondemand/`)
}

const linkWebDB = (from, to) => {
  send(to, `${from}: https://played.vacker.tv/`)
}

const parseOptions = str => {
  // g: activity
  // t: type
  // s: streamer
  // e: exclusion (from activity)
  const g = /g:(?:\s*)([\w\d\s&%$#@!*()_,+=[\]{}'"./\\-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const t = /t:(?:\s*)([\w\d\s-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const s = /s:(?:\s*)([\w\d\s-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const e = /e:(?:\s*)([\w\d\s&%$#@!*()_,+=[\]{}'"./\\-]*?)(?:[\W]*)(?:(?:[gtse]:)|$)/i.exec(str)
  const i = /p(?:layed)?:?(?:\s*)-(\d+)/.exec(str)
  const res = {
    g: g ? g[1] : null,
    t: t ? t[1] : null,
    s: s ? s[1] : null,
    e: e ? e[1].split(/(?:\s*)(?:([\w\d\s&%$#@!*()_-]*),?)/).filter(x => x !== '') : null,
    i: i ? i[1] : null,
  }
  log.debug(res, 'OPTIONS RESULTS')
  return res
}

const playedConstructor = options => {
  const query = db.select()
    .from('sessions_view')
    .where(builder => {
      if (options.g) builder.andWhere('activity', 'LIKE', `%${options.g}%`)
      if (options.e) builder.andWhere(builder => {
        options.e.forEach(exclusion => {
          builder.andWhere('activity', 'NOT LIKE', `%${exclusion}%`)
        })
      })
      if (options.t) builder.andWhere('activity_type', 'LIKE', `%${options.t}%`)
      if (options.s) builder.andWhere(builder => {
        const aliases = streamerAliases.find(x => x.some(y => y.toLowerCase() === options.s))
        if (aliases) aliases.forEach(alias => builder.orWhere('streamer', 'RLIKE', `[[:<:]]${alias}[[:>:]]`))
        else builder.andWhere('streamer', 'RLIKE', `[[:<:]]${options.s}[[:>:]]`)
      })
    })
  log.debug({ query: query.toString() }, 'CONSTRUCTED QUERY')

  return query
}

const lastPlayed = (from, to, message) => {
  const options = parseOptions(message)

  playedConstructor(options)
    .limit(options.i + 1 || 1)
    .then(res => {
      if (!res.length) {
        send(to, `I didn't find any results for "${message}"`)
        return null
      }
      res = res[Math.min(options.i, res.length - 1) || 0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const output = `${from}: ${res.streamer} streamed the ${res.activity_type} ${res.activity} for ${leftPad(duration.get('hours'))}:${leftPad(duration.get('minutes'))}:${leftPad(duration.get('seconds'))}, about ${moment.utc(res.end_timestamp).subtract(7, 'h').fromNow()}`
      send(to, output)
    })
    .catch(err => log.error(err))
}

const firstPlayed = (from, to, message) => {
  const options = parseOptions(message)

  playedConstructor(options)
    .limit(1)
    .orderBy('session_id', 'ASC')
    .then(res => {
      if (!res.length) {
        send(to, `I didn't find any results for "${message}"`)
        return null
      }
      res = res[0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const output = `${from}: ${res.streamer} first streamed the ${res.activity_type} ${res.activity} for ${leftPad(duration.get('hours'))}:${leftPad(duration.get('minutes'))}:${leftPad(duration.get('seconds'))}, about ${moment.utc(res.end_timestamp).subtract(7, 'h').fromNow()}`
      send(to, output)
    })
    .catch(err => log.error(err))
  return null
}

const totalPlayed = (from, to, message) => {
  const options = parseOptions(message)
  const searchQuery = playedConstructor(options)

  db
    .raw('SET SQL_MODE=\'ALLOW_INVALID_DATES\'')
    .then(() => db.raw('drop temporary table if exists totalgames'))
    .then(() => db.raw(searchQuery.toString()).wrap('create temporary table totalgames(primary key(session_id))'))
    .then(() => db.raw('select start_timestamp into @st from totalgames order by session_id asc limit 1'))
    .then(() => db.raw('select end_timestamp into @en from totalgames order by session_id desc limit 1'))
    .then(() => db.raw('select streamer into @str from totalgames order by session_id desc limit 1'))
    .then(() => db.raw('select sum(duration_in_seconds) into @dur from totalgames'))
    .then(() => db.raw('select @st as start_timestamp, @en as end_timestamp, @str as streamer, @dur as duration_in_seconds'))
    .then(res => {
      res = res[0][0]
      const duration = moment.duration(res.duration_in_seconds, 'seconds')
      const output = `${from}: ${options.g} was last streamed by ${res.streamer} on ${moment.utc(res.end_timestamp).subtract('7', 'h')}, was first streamed on ${moment.utc(res.start_timestamp).subtract('7', 'h')}, and has been streamed for a total of ${leftPad(duration.get('months'))}:${leftPad(duration.get('days'))}:${leftPad(duration.get('hours'))}:${leftPad(duration.get('minutes'))}:${leftPad(duration.get('seconds'))} (Mo:D:H:M:S)`
      send(to, output)
    })
    .catch(err => log.error(err))

  return null
}

const currentlyPlaying = (from, to) => {
  db.select()
    .from('sessions_view')
    .limit(1)
    .then(res => {
      if (!res.length) {
        send(to, `Sorry ${from}, it looks to me like nobody's ever streamed.`)
        return null
      }

      res = res[0]

      const duration = moment.duration(moment.utc().diff(moment.utc(res.start_timestamp).subtract(7, 'h'), 'milliseconds'), 'milliseconds')
      const response = (res.end_timestamp) ? 'Nobody is currently streaming.' : `${res.streamer} has been streaming the ${res.activity_type} ${res.activity} for ${leftPad(duration.get('hours'))}:${leftPad(duration.get('minutes'))}:${leftPad(duration.get('seconds'))}`
      const output = `${from}: ${response}`
      send(to, output)
    })
    .catch(err => log.error(err))
}

const send = (to, message, notice) => {
  if (notice) return client.notice(to, message)
  if (silentChannels.some(channel => channel === to)) return null
  client.say(to, message)
}

// const playedToday = (from, to, message) => {
//   return null
// }

const shutdown = (code = 0, reason = '') => {
  if (forceKill) {
    log.error('!!! FORCING SHUTDOWN !!!')
    client.conn.destroy()
    process.exit(1)
  }
  log.warn({ reason }, 'Shutting Down')
  client.disconnect((code === 0) ? 'Shutting Down' : 'Error', () => process.exit(code))
  forceKill = true
}

// Command mapping
const commands = {
  'p': lastPlayed,
  'played': lastPlayed,
  'l': lastPlayed,
  'last': lastPlayed,
  'lastplayed': lastPlayed,
  'f': firstPlayed,
  'first': firstPlayed,
  'firstplayed': firstPlayed,
  't': totalPlayed,
  'total': totalPlayed,
  'totalplayed': totalPlayed,
  'c': currentlyPlaying,
  'current': currentlyPlaying,
  'currentlyplaying': currentlyPlaying,
  'discord': linkDiscord,
  'ondemand': linkOnDemand,
  'web': linkWebDB,
  'playedweb': linkWebDB,
  // 'today': playedToday,
  // 'playedtoday': playedToday,
  // my $com_nextplayed = "!nextplayed";
  // my $com_firstplayedleet = "!f1r57p14y3d";
  // my $com_randomplayed = "!randomplayed";
  // my $com_randomplayedleet = "!r4nd0mp14y3d";

  // my $com_lastplayedwisdom = "!lastplayedwisdom";
  // my $com_lastplayedwisdom2 = "!playedwisdom";
  // my $com_lastplayedwisdomleet = "!p14y3dw15d0m";
  // my $com_lastplayedweb = "!lastplayedweb";
  // my $com_lastplayedweb2 = "!playedweb";
  // my $com_playedleet = "!pl4y3d";
  // my $com_playedleet2 = "!p14y3d";
  // my $com_lastplayedleet = "!l457p14y3d";
  // my $com_lastplayedleet2 = "!1457p14y3d";

  // my $com_lastplayedhelp = "!lastplayedhelp";
  // my $com_lastplayedhelp2 = "!playedhelp";
  // my $com_lastplayedhelp3 = "!man lastplayed";

  // my $com_playedtoday = "!playedtoday";
  // my $com_playedtoday2 = "!played24h";
  // my $com_playedtoday3 = "!todayplayed";

  // my $com_playednobody = "!nobodyplayed";
  // my $com_playedfake = "!p1ayed";
  // my $com_playedfake2 = "!playedfake";
  // my $com_playedfake3 = "!notrealplayed";
  // my $com_playedfake4 = "!prayed";
  // my $com_playedfake5 = "!pIayed";
  // my $com_playedfake6 = "!playedruse";
}

/*
**  Event Listeners
*/

client.addListener('message', parseMessage)
client.addListener('topic', parseTopic)
client.addListener('registered', () => log.info('Client connected...'))
client.addListener('error', err => shutdown(1, err))
process.on('SIGINT', () => shutdown())
process.on('uncaughtException', err => shutdown(1, err))

/*
**  Run
*/

log.info('Connecting...')
db.raw('call countUnmappedActivities()')
  .then(res => {
    log.warn(res[0][0][0])
    client.connect()
  })
  .catch(err => {
    log.error(err)
    shutdown(1, err)
  })
