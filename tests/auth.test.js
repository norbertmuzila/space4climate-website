/* Password hashing, session token handling and Google ID token rejection.
   Run: node tests/auth.test.js */
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Set before requiring: auth.js reads the client id once, at load. With one
// present the Google checks run for real instead of refusing everything up
// front, which is the path worth testing.
process.env.GOOGLE_CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const { internals } = require('../api/auth.js');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

async function run() {
  console.log('\npasswords');
  const hash = await internals.hashPassword('correct horse battery');
  check('stored in scrypt format', hash.split('$')[0], 'scrypt');
  check('the password itself is not in the record', hash.includes('correct horse battery'), false);
  check('right password verifies', await internals.passwordMatches('correct horse battery', hash), true);
  check('wrong password does not', await internals.passwordMatches('correct horse batteryx', hash), false);
  check('empty password does not', await internals.passwordMatches('', hash), false);
  check('a garbage record does not verify', await internals.passwordMatches('x', 'not-a-hash'), false);
  check('a missing record does not verify', await internals.passwordMatches('x', undefined), false);

  const again = await internals.hashPassword('correct horse battery');
  check('salted: the same password hashes differently each time', hash === again, false);
  check('...but both still verify', await internals.passwordMatches('correct horse battery', again), true);

  console.log('\ncross-implementation: a hash written by dev-server.py verifies here');
  // The two runtimes must agree, or accounts made locally would stop working
  // once the same records are served from the deployed function.
  const pyHash = execFileSync(
    'python',
    [
      '-c',
      [
        'import base64,hashlib,secrets',
        'salt=secrets.token_bytes(16)',
        'key=hashlib.scrypt(b"correct horse battery",salt=salt,n=16384,r=8,p=1,dklen=64)',
        'print("scrypt$16384$8$1$"+base64.b64encode(salt).decode()+"$"+base64.b64encode(key).decode())'
      ].join(';')
    ],
    { encoding: 'utf8' }
  ).trim();
  check('python hash parses and verifies in node', await internals.passwordMatches('correct horse battery', pyHash), true);
  check('python hash rejects the wrong password', await internals.passwordMatches('wrong', pyHash), false);

  console.log('\nsession tokens');
  const token = crypto.randomBytes(32).toString('base64url');
  check('stored as a digest, not the token', internals.hashToken(token) === token, false);
  check('digest is stable', internals.hashToken(token), internals.hashToken(token));
  check('different tokens, different digests', internals.hashToken('a') === internals.hashToken('b'), false);

  console.log('\nGoogle ID tokens');
  async function reject(value) {
    try {
      await internals.verifyGoogleToken(value);
      return 'ACCEPTED';
    } catch (err) {
      return err.message;
    }
  }

  // These all fail before any network call.
  check('rejected: empty', await reject(''), 'google_bad_token');
  check('rejected: not a JWT', await reject('nonsense'), 'google_bad_token');
  check('rejected: wrong segment count', await reject('a.b'), 'google_bad_token');
  check(
    'rejected: unsigned "none" algorithm',
    await reject(`${Buffer.from('{"alg":"none"}').toString('base64url')}.e30.`),
    'google_bad_token'
  );

  // A token that is correctly shaped and genuinely RS256-signed, but by a key
  // we generated rather than Google's. Signature validity alone must not be
  // enough — the key has to be one Google published.
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'forged-kid' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      email: 'attacker@example.org',
      email_verified: true,
      sub: '1',
      exp: Math.floor(Date.now() / 1000) + 3600
    })
  ).toString('base64url');
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey)
    .toString('base64url');
  const forged = await reject(`${header}.${claims}.${signature}`);
  check(
    'rejected: validly signed by the wrong key',
    forged === 'google_bad_token' || forged === 'google_certs_unavailable',
    true
  );
  check('...and specifically not accepted', forged === 'ACCEPTED', false);

  console.log('\nvalidation patterns');
  check('email accepted', internals.EMAIL_RE.test('ada@example.org'), true);
  check('email without domain rejected', internals.EMAIL_RE.test('ada@'), false);
  check('username accepted', internals.USERNAME_RE.test('ada.love-99_x'), true);
  check('username too short rejected', internals.USERNAME_RE.test('ad'), false);
  check('username with space rejected', internals.USERNAME_RE.test('ada love'), false);
  check('username with @ rejected', internals.USERNAME_RE.test('ada@love'), false);

  console.log('\npublicUser never leaks secrets');
  const view = internals.publicUser({
    id: 'u_1',
    name: 'Ada',
    username: 'ada',
    email: 'ada@example.org',
    passwordHash: 'scrypt$secret',
    googleSub: '12345',
    createdAt: 1
  });
  check('no password hash', 'passwordHash' in view, false);
  check('no google subject id', 'googleSub' in view, false);
  check('keeps what the page needs', Object.keys(view).sort(), [
    'createdAt',
    'email',
    'id',
    'name',
    'picture',
    'provider',
    'username'
  ]);

  console.log(`\n${pass} passed, ${fail} failed`);
  // Set the code rather than calling process.exit: the Google certificate
  // fetch may still be closing its socket, and tearing the loop down under it
  // trips a libuv assertion on Windows.
  process.exitCode = fail ? 1 : 0;
}

run();
