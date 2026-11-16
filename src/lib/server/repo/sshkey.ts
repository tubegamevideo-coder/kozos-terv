import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * SSH-kulcsok a repók olvasásához (deploy key). A privát kulcs fájlban él a szerver adatmappájában
 * (`REPO_STATE_DIR`, Dockerben `/data`), sosem az adatbázisban, és sosem jelenik meg a felületen.
 */

export interface SshKeyPair {
	/** Egy sor, ahogy a GitHub/GitLab Deploy keys mezője várja: `ssh-ed25519 AAAA… megjegyzés`. */
	publicKey: string;
	/** OpenSSH-formátum, jelszó nélkül (mint az `ssh-keygen -t ed25519 -N ""` kimenete). */
	privateKey: string;
	/** `SHA256:…`, ahogy a GitHub és az `ssh-keygen -l` mutatja. */
	fingerprint: string;
}

const u32 = (n: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(n);
	return b;
};
const sshString = (v: Buffer | string) => {
	const b = typeof v === 'string' ? Buffer.from(v) : v;
	return Buffer.concat([u32(b.length), b]);
};

export const sshFingerprint = (publicBlob: Buffer) =>
	`SHA256:${createHash('sha256').update(publicBlob).digest('base64').replace(/=+$/, '')}`;

/** Új ed25519 kulcspár. A megjegyzés csak ASCII legyen (a kulcs sorában látszik). */
export function generateSshKey(comment: string): SshKeyPair {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
	const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url');
	const type = 'ssh-ed25519';
	const blob = Buffer.concat([sshString(type), sshString(pub)]);

	// openssh-key-v1: titkosítás nélkül, egy kulcs; a privát rész 8 bájtra párnázva (1, 2, 3, …).
	const check = randomBytes(4);
	let priv = Buffer.concat([check, check, sshString(type), sshString(pub), sshString(Buffer.concat([seed, pub])), sshString(comment)]);
	const pad = (8 - (priv.length % 8)) % 8;
	priv = Buffer.concat([priv, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
	const body = Buffer.concat([
		Buffer.from('openssh-key-v1\0', 'latin1'),
		sshString('none'),
		sshString('none'),
		sshString(''),
		u32(1),
		sshString(blob),
		sshString(priv)
	]);
	const pem = body.toString('base64').replace(/.{1,70}/g, '$&\n');
	return {
		publicKey: `${type} ${blob.toString('base64')} ${comment}`,
		privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${pem}-----END OPENSSH PRIVATE KEY-----\n`,
		fingerprint: sshFingerprint(blob)
	};
}

/** A szerver adatmappája (kulcsok, git-gyorsítótár, ismert gépek). */
export const repoStateDir = () => process.env.REPO_STATE_DIR?.trim() || join(tmpdir(), 'kozos-terv');

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * A kulcsfájl neve a repó azonosítójából és a nyilvános kulcsból jön, így kulcscserénél az új fájl
 * a régi mellé kerül, és az adatbázis mindig létező fájlra mutat (a régit a csere után töröljük).
 */
export function keyFilePath(repoId: string, publicKey: string) {
	if (!ID_RE.test(repoId)) throw new Error('érvénytelen repóazonosító');
	const h = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
	return join(repoStateDir(), 'keys', `${repoId}.${h}`);
}

export const keyStore = {
	async save(repoId: string, pair: SshKeyPair) {
		const file = keyFilePath(repoId, pair.publicKey);
		await mkdir(join(repoStateDir(), 'keys'), { recursive: true, mode: 0o700 });
		await writeFile(file, pair.privateKey, { mode: 0o600 });
		await chmod(file, 0o600); // ha már létezett, a mód is legyen szigorú
		return file;
	},
	async exists(repoId: string, publicKey: string) {
		try {
			return (await stat(keyFilePath(repoId, publicKey))).isFile();
		} catch {
			return false;
		}
	},
	async remove(repoId: string, publicKey: string) {
		await rm(keyFilePath(repoId, publicKey), { force: true });
	}
};
