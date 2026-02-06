import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import { 
  createMint, 
  createAccount, 
  mintTo, 
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("anchor-amm-q4-25", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorAmmQ425 as Program<AnchorAmmQ425>;
  
  // Test accounts
  let mintX: PublicKey;
  let mintY: PublicKey;
  let mintLp: PublicKey;
  let config: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;
  let userXAccount: PublicKey;
  let userYAccount: PublicKey;
  let userLpAccount: PublicKey;
  
  const seed = new BN(1);
  const fee = 300; // 3% fee (300 basis points)
  const initializer = provider.wallet as anchor.Wallet;
  const user = initializer;

  before(async () => {
    // Create mints for token X and Y
    mintX = await createMint(
      provider.connection,
      initializer.payer,
      initializer.publicKey,
      null,
      6 // 6 decimals
    );

    mintY = await createMint(
      provider.connection,
      initializer.payer,
      initializer.publicKey,
      null,
      6 // 6 decimals
    );

    // Derive PDAs
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [mintLp] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    );

    // Derive associated token accounts
    [vaultX] = PublicKey.findProgramAddressSync(
      [
        config.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintX.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    [vaultY] = PublicKey.findProgramAddressSync(
      [
        config.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintY.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Create user token accounts
    userXAccount = await createAccount(
      provider.connection,
      initializer.payer,
      mintX,
      user.publicKey
    );

    userYAccount = await createAccount(
      provider.connection,
      initializer.payer,
      mintY,
      user.publicKey
    );

    [userLpAccount] = PublicKey.findProgramAddressSync(
      [
        user.publicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintLp.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Mint tokens to user accounts
    await mintTo(
      provider.connection,
      initializer.payer,
      mintX,
      userXAccount,
      initializer.publicKey,
      1_000_000_000 // 1000 tokens with 6 decimals
    );

    await mintTo(
      provider.connection,
      initializer.payer,
      mintY,
      userYAccount,
      initializer.publicKey,
      1_000_000_000 // 1000 tokens with 6 decimals
    );
  });

  it("Initialize pool", async () => {
    const tx = await program.methods
      .initialize(seed, fee, null)
      .accounts({
        initializer: initializer.publicKey,
        mintX,
        mintY,
        mintLp,
        vaultX,
        vaultY,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize transaction signature", tx);

    // Verify config account
    const configAccount = await program.account.config.fetch(config);
    assert.equal(configAccount.seed.toNumber(), seed.toNumber());
    assert.equal(configAccount.fee, fee);
    assert.equal(configAccount.locked, false);
    assert.equal(configAccount.mintX.toBase58(), mintX.toBase58());
    assert.equal(configAccount.mintY.toBase58(), mintY.toBase58());

    console.log("Pool initialized successfully!");
  });

  it("Deposit liquidity (initial)", async () => {
    const amount = new BN(100_000_000); // 100 LP tokens
    const maxX = new BN(100_000_000); // 100 token X
    const maxY = new BN(100_000_000); // 100 token Y

    const tx = await program.methods
      .deposit(amount, maxX, maxY)
      .accounts({
        user: user.publicKey,
        mintX,
        mintY,
        config,
        mintLp,
        vaultX,
        vaultY,
        userX: userXAccount,
        userY: userYAccount,
        userLp: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Deposit transaction signature", tx);

    // Verify LP tokens were minted
    const userLpAccountInfo = await getAccount(provider.connection, userLpAccount);
    assert.equal(userLpAccountInfo.amount.toString(), amount.toString());

    // Verify tokens were transferred to vaults
    const vaultXInfo = await getAccount(provider.connection, vaultX);
    const vaultYInfo = await getAccount(provider.connection, vaultY);
    assert.equal(vaultXInfo.amount.toString(), maxX.toString());
    assert.equal(vaultYInfo.amount.toString(), maxY.toString());

    console.log("Initial liquidity deposited successfully!");
  });

  it("Deposit additional liquidity", async () => {
    const amount = new BN(50_000_000); // 50 LP tokens
    const maxX = new BN(60_000_000); // Max 60 token X
    const maxY = new BN(60_000_000); // Max 60 token Y

    const userLpBefore = await getAccount(provider.connection, userLpAccount);

    const tx = await program.methods
      .deposit(amount, maxX, maxY)
      .accounts({
        user: user.publicKey,
        mintX,
        mintY,
        config,
        mintLp,
        vaultX,
        vaultY,
        userX: userXAccount,
        userY: userYAccount,
        userLp: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Additional deposit transaction signature", tx);

    // Verify LP tokens increased
    const userLpAfter = await getAccount(provider.connection, userLpAccount);
    assert.equal(
      userLpAfter.amount.toString(),
      new BN(userLpBefore.amount.toString()).add(amount).toString()
    );

    console.log("Additional liquidity deposited successfully!");
  });

  it("Swap X for Y", async () => {
    const amountIn = new BN(10_000_000); // 10 token X
    const minOut = new BN(1); // Minimum 0.000001 token Y (allow any amount for testing)

    const userYBefore = await getAccount(provider.connection, userYAccount);
    const vaultXBefore = await getAccount(provider.connection, vaultX);
    const vaultYBefore = await getAccount(provider.connection, vaultY);

    const tx = await program.methods
      .swap(true, amountIn, minOut) // true means swapping X for Y
      .accounts({
        user: user.publicKey,
        mintX,
        mintY,
        config,
        vaultX,
        vaultY,
        userX: userXAccount,
        userY: userYAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Swap X for Y transaction signature", tx);

    // Verify vault balances changed
    const vaultXAfter = await getAccount(provider.connection, vaultX);
    const vaultYAfter = await getAccount(provider.connection, vaultY);
    
    assert.ok(
      new BN(vaultXAfter.amount.toString()).gt(new BN(vaultXBefore.amount.toString()))
    );
    assert.ok(
      new BN(vaultYAfter.amount.toString()).lt(new BN(vaultYBefore.amount.toString()))
    );

    // Verify user received Y tokens
    const userYAfter = await getAccount(provider.connection, userYAccount);
    assert.ok(
      new BN(userYAfter.amount.toString()).gt(new BN(userYBefore.amount.toString()))
    );

    console.log("Swap X for Y successful!");
  });

  it("Swap Y for X", async () => {
    const amountIn = new BN(5_000_000); // 5 token Y
    const minOut = new BN(1); // Minimum output

    const userXBefore = await getAccount(provider.connection, userXAccount);
    const vaultXBefore = await getAccount(provider.connection, vaultX);
    const vaultYBefore = await getAccount(provider.connection, vaultY);

    const tx = await program.methods
      .swap(false, amountIn, minOut) // false means swapping Y for X
      .accounts({
        user: user.publicKey,
        mintX,
        mintY,
        config,
        vaultX,
        vaultY,
        userX: userXAccount,
        userY: userYAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Swap Y for X transaction signature", tx);

    // Verify vault balances changed
    const vaultXAfter = await getAccount(provider.connection, vaultX);
    const vaultYAfter = await getAccount(provider.connection, vaultY);
    
    assert.ok(
      new BN(vaultXAfter.amount.toString()).lt(new BN(vaultXBefore.amount.toString()))
    );
    assert.ok(
      new BN(vaultYAfter.amount.toString()).gt(new BN(vaultYBefore.amount.toString()))
    );

    // Verify user received X tokens
    const userXAfter = await getAccount(provider.connection, userXAccount);
    assert.ok(
      new BN(userXAfter.amount.toString()).gt(new BN(userXBefore.amount.toString()))
    );

    console.log("Swap Y for X successful!");
  });

  it("Withdraw liquidity", async () => {
    const userLpBefore = await getAccount(provider.connection, userLpAccount);
    const withdrawAmount = new BN(new BN(userLpBefore.amount.toString()).divn(2).toString()); // Withdraw half
    const minX = new BN(1); // Minimum amounts (allow any for testing)
    const minY = new BN(1);

    const userXBefore = await getAccount(provider.connection, userXAccount);
    const userYBefore = await getAccount(provider.connection, userYAccount);

    const tx = await program.methods
      .withdraw(withdrawAmount, minX, minY)
      .accounts({
        user: user.publicKey,
        mintX,
        mintY,
        config,
        mintLp,
        vaultX,
        vaultY,
        userX: userXAccount,
        userY: userYAccount,
        userLp: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Withdraw transaction signature", tx);

    // Verify LP tokens were burned
    const userLpAfter = await getAccount(provider.connection, userLpAccount);
    assert.equal(
      userLpAfter.amount.toString(),
      new BN(userLpBefore.amount.toString()).sub(withdrawAmount).toString()
    );

    // Verify user received tokens back
    const userXAfter = await getAccount(provider.connection, userXAccount);
    const userYAfter = await getAccount(provider.connection, userYAccount);
    
    assert.ok(
      new BN(userXAfter.amount.toString()).gt(new BN(userXBefore.amount.toString()))
    );
    assert.ok(
      new BN(userYAfter.amount.toString()).gt(new BN(userYBefore.amount.toString()))
    );

    console.log("Withdraw successful!");
  });
});