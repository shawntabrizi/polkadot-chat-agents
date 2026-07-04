use std::env;

use verifiable::ring::RingDomainSize;
use verifiable::ring::bandersnatch::BandersnatchVrfVerifiable;
use verifiable::GenerateVerifiable;

fn decode_hex(input: &str, expected_len: Option<usize>) -> Result<Vec<u8>, String> {
    let clean = input.strip_prefix("0x").unwrap_or(input);
    if clean.len() % 2 != 0 {
        return Err("hex string must have an even number of characters".to_string());
    }

    let mut bytes = Vec::with_capacity(clean.len() / 2);
    for index in (0..clean.len()).step_by(2) {
        let byte = u8::from_str_radix(&clean[index..index + 2], 16)
            .map_err(|_| "hex string contains a non-hex character".to_string())?;
        bytes.push(byte);
    }

    if let Some(len) = expected_len {
        if bytes.len() != len {
            return Err(format!("expected {len} bytes, got {}", bytes.len()));
        }
    }

    Ok(bytes)
}

fn encode_hex(bytes: impl AsRef<[u8]>) -> String {
    let mut output = String::with_capacity(bytes.as_ref().len() * 2 + 2);
    output.push_str("0x");
    for byte in bytes.as_ref() {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  summit-bandersnatch-cli derive-member-key <entropy-hex-32>");
    eprintln!("  summit-bandersnatch-cli sign <entropy-hex-32> <message-hex>");
    eprintln!("  summit-bandersnatch-cli derive-alias <entropy-hex-32> <context-hex>");
    eprintln!("  summit-bandersnatch-cli create-proof <entropy-hex-32> <domain11|domain12|domain16> <context-hex> <message-hex> <member-hex>...");
    eprintln!("  summit-bandersnatch-cli lite-person <entropy-hex-32> <message-hex>");
    std::process::exit(2);
}

fn entropy_from_arg(value: &str) -> Result<[u8; 32], String> {
    decode_hex(value, Some(32))?
        .try_into()
        .map_err(|_| "expected 32-byte entropy".to_string())
}

fn member_key(entropy: [u8; 32]) -> Vec<u8> {
    let secret = BandersnatchVrfVerifiable::new_secret(entropy);
    BandersnatchVrfVerifiable::member_from_secret(&secret)
        .as_ref()
        .to_vec()
}

fn signature(entropy: [u8; 32], message: &[u8]) -> Result<Vec<u8>, String> {
    let secret = BandersnatchVrfVerifiable::new_secret(entropy);
    BandersnatchVrfVerifiable::sign(&secret, message)
        .map(|signature| signature.as_ref().to_vec())
        .map_err(|_| "failed to sign message".to_string())
}

fn parse_domain(value: &str) -> Result<RingDomainSize, String> {
    match value.to_ascii_lowercase().as_str() {
        "domain11" | "11" | "r2e9" => Ok(RingDomainSize::Domain11),
        "domain12" | "12" | "r2e10" => Ok(RingDomainSize::Domain12),
        "domain16" | "16" | "r2e14" => Ok(RingDomainSize::Domain16),
        _ => Err(format!("unsupported domain size: {value}")),
    }
}

fn alias(entropy: [u8; 32], context: &[u8]) -> Result<Vec<u8>, String> {
    let secret = BandersnatchVrfVerifiable::new_secret(entropy);
    BandersnatchVrfVerifiable::alias_in_context(&secret, context)
        .map(|alias| alias.as_ref().to_vec())
        .map_err(|_| "failed to derive alias".to_string())
}

fn proof(
    entropy: [u8; 32],
    domain: RingDomainSize,
    context: &[u8],
    message: &[u8],
    member_hexes: &[String],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let secret = BandersnatchVrfVerifiable::new_secret(entropy);
    let member = BandersnatchVrfVerifiable::member_from_secret(&secret);
    let members = member_hexes
        .iter()
        .map(|value| {
            let bytes = decode_hex(value, Some(member.as_ref().len()))?;
            bytes
                .try_into()
                .map_err(|_| "member key has invalid length".to_string())
        })
        .collect::<Result<Vec<<BandersnatchVrfVerifiable as GenerateVerifiable>::Member>, String>>()?;

    let commitment = BandersnatchVrfVerifiable::open(
        domain,
        &member,
        members.into_iter(),
    )
    .map_err(|_| "failed to open ring commitment; member is probably not in the ring".to_string())?;

    BandersnatchVrfVerifiable::create(commitment, &secret, context, message)
        .map(|(proof, alias)| (proof.iter().copied().collect(), alias.as_ref().to_vec()))
        .map_err(|_| "failed to create proof".to_string())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("derive-member-key") if args.len() == 3 => {
            entropy_from_arg(&args[2]).map(|entropy| println!("{}", encode_hex(member_key(entropy))))
        }
        Some("sign") if args.len() == 4 => {
            let entropy = entropy_from_arg(&args[2]);
            let message = decode_hex(&args[3], None);
            entropy.and_then(|entropy| message.and_then(|message| signature(entropy, &message)))
                .map(|signature| println!("{}", encode_hex(signature)))
        }
        Some("derive-alias") if args.len() == 4 => {
            let entropy = entropy_from_arg(&args[2]);
            let context = decode_hex(&args[3], None);
            entropy.and_then(|entropy| context.and_then(|context| alias(entropy, &context)))
                .map(|alias| println!("{}", encode_hex(alias)))
        }
        Some("create-proof") if args.len() >= 7 => {
            let entropy = entropy_from_arg(&args[2]);
            let domain = parse_domain(&args[3]);
            let context = decode_hex(&args[4], None);
            let message = decode_hex(&args[5], None);
            entropy
                .and_then(|entropy| {
                    domain.and_then(|domain| {
                        context.and_then(|context| {
                            message.and_then(|message| {
                                proof(entropy, domain, &context, &message, &args[6..])
                            })
                        })
                    })
                })
                .map(|(proof, alias)| {
                    println!(
                        "{{\"proof\":\"{}\",\"alias\":\"{}\"}}",
                        encode_hex(proof),
                        encode_hex(alias)
                    )
                })
        }
        Some("lite-person") if args.len() == 4 => {
            let entropy = entropy_from_arg(&args[2]);
            let message = decode_hex(&args[3], None);
            entropy
                .and_then(|entropy| {
                    message.and_then(|message| {
                        let member_key = encode_hex(member_key(entropy));
                        let proof_of_ownership = encode_hex(signature(entropy, &message)?);
                        println!(
                            "{{\"memberKey\":\"{}\",\"proofOfOwnership\":\"{}\"}}",
                            member_key, proof_of_ownership
                        );
                        Ok(())
                    })
                })
        }
        _ => usage(),
    };

    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
