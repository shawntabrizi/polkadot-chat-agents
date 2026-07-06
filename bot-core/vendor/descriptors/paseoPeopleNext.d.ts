import { StorageDescriptor, PlainDescriptor, TxDescriptor, RuntimeDescriptor, Enum, ApisFromDef, QueryFromPalletsDef, TxFromPalletsDef, EventsFromPalletsDef, ErrorsFromPalletsDef, ConstFromPalletsDef, ViewFnsFromPalletsDef, SS58String, SizedHex, FixedSizeArray } from "polkadot-api";
import type { I5sesotjlssv2d, Iffmde3ekjedi9, I4mddgoa69c0a2, I3v2vo485iral6, I95g6i7ilua7lq, Ieniouoqkq4icf, Phase, Ibgl04rn6nbfm6, I4q39t5hn830vp, I8re9183nrhr3n, I1v7jbnil3tjns, I8jgj1nhcr2dg8, Ifn6q3equiq9qi, Ia3sb0vgvovhtg, Iav8k1edbj86k7, Itom7fk49o0c9, I4i91h98n3cv1b, I4iumukclgj8ej, Iqnbvitf7a7l3, I48i407regf59r, I6r5cbv8ttrb09, Inofn0qqbjtb9, I1q8tnt1cluu5j, I8ds64oj6581v0, Ia7pdug7cdsg8g, Iff83br6to6vp5, I9bin2jc70qt6q, TransactionPaymentReleases, Icj0tssrh6ika3, I8arc778cv9pqq, I3qklfjubrljqh, If9iqq7i64mur8, Iag3f1hum3p4c8, I4v5g6i7bmt06o, I4s6jkha20aoh0, I84bhscllvv07n, I78s05f59eoi8b, If2801grpltbp8, Ia2lhg7l2hilo3, Ifi4da1gej1fri, Ifvgo9568rpmqc, I82jm9g7pufuel, Ic5m5lp1oioo8r, I6cs1itejju2vv, Icgljjb6j82uhn, I9pvau8qut93lg, I5g2vv0ckl2m8b, Ifup3lg9ro8a0f, I5qfubnuvrnqn6, I8t3u2dv73ahbd, I7vlvrrl2pnbgk, Ie0rpl5bahldfk, XcmPalletVersionMigrationStage, I7e5oaj2qi4kl1, Ie849h3gncgvok, Iat62vud7hlod2, Ict03eedr8de9s, Ici7ejds60vj52, XcmVersionedLocation, Idh2ug6ou4a8og, Iejeo53sea6n4q, I53esa2ms463bk, Ib4jhb8tt3uung, Iag146hmjgqfgj, I8uo3fpd3bcc6f, I48e2fe747rjco, I9p9lq3rej5bhc, I8sp8i1c9u7kvv, I910puuahutflf, I4nfjdef0ibh44, I74af64m08r6as, Ic8ann3kre6vdm, I1j72qfgdejqsv, I60biiepd74113, I2skcsqibb3i2k, I4ekkp6f1d7a69, Ifpolrv9bn0ss8, Icq9999ubti4jr, I6vki5ip88t309, I5h2gdbrcdulu5, I4p5t2krb1gmvp, Id32895epm7otq, I14eopu9hl6hgk, Iaq1a4h34blh5u, Ieaqfchj8o5p3e, Ia11lg4mrmjqfg, Idevgv5mu1k9gt, Ic5ardbudan54b, I6n9krukma1mut, Ie6cl0ap8d265e, I9feps983hs1sf, I9jd27rnpm8ttv, I63ubv9qb76gl3, I2na29tt2afp0j, Ifip05kcrl65am, I1mvbp74tfuinr, I9u9nqhm3kqr8q, I191vhdj2skphj, Iavh3dqjok18o8, Idm8j2k0kcll3q, I5uteah8rq8etm, I9sbfhir4aitej, I5rab7drti2f9h, I26np7pq4hc9kt, Idrbto15rld189, I6lggg4mrl1u2s, I3nqube2n1nohj, Idodgrto60av5h, Id26d02t80vjh, I4009rejbekrdq, I81vbsdqasdsr1, I23bplm6qtgrpd, Ifopum5rctcidn, I9jea06984vfti, I8vqqii9cbfqng, Id77vvrgqmru2o, Ic66kva37scc9l, I1fa62uavcqia6, I7hvvp2oeegqa0, Ie3d56aup8po4r, I9lcj3313n9e9v, I3136o2hmi4al3, I4pact7n2e9a0i, Iff5ulsdvgntip, Iara29l6qkt9is, I2t447bb26t9i6, I831tj5voub6u0, I54g1hqjgru9ba, I2ccsdtloqt0h4, I766emmc9ccni0, I6sjgjftjavcbd, I2l7r05e3266s4, I5eoome1iv99mc, Ib55cg44k2chb5, I6msd8eb5ee1ee, I5b6v7o79lps5k, I4hus3s8lblmj7, Iff773s2hdisds, Ieenjgm8k62jr1, I92h4q810prvth, Ieso6d402ilf6g, I6cunlo5qsnfm5, Id5m5ie1nmrke2, I58ai4tjcgea3g, Ibto3ou3o2r7sv, I94nsao83dbuk9, Iepbsvlk3qceij, In7a38730s6qs, Ibtil0ss5munbk, I9s0ave7t0vnrk, I4fo08joqmcqnm, XcmV5Junctions, Iasb8k6ash5mjn, Idvob66qflhcgd, I7qcffr6se5g9, I8ofcg5rbj0g2c, I4adgbll7gku4i, I6pjjpfvhvcfru, I9pj91mj79qekl, I39uah9nss64h9, Ik64dknsq7k08, Ib51vk42m1po4n, Ial23jn8hp0aen, Ifpj261e8s63m3, Idcr6u6361oad9, I4ktuaksf5i1gk, I9bqtpv2ii35mp, I9j7pagd6d4bda, I2h9pmio37r7fb, Ibmr18suc9ikh9, I9iq22t0burs89, I5u8olqbbvfnvf, I5utcetro501ir, Iea5hvin03frku, I7t2thek61ghou, I61tdrsafr1vf3, Ibsk5g3rhm45pu, Icfoe9q8d4vs8f, Ibrfmvjrg4trnb, Iedih7t34maii9, I4e902qbfel1f1, Ie4met0joi8sv0, I1t8vq6a06ohhu, Icvt3pdunbinm7, I9ui3n41balr2q, I89sl7btgl24g2, I3u6g26k9kn96u, If1invp94rsjms, Ie5nc19gtiv5sv, Iald3dgvt1hjkb, Iurrhahet4gno, I5tamv2nk8bj8o, I8apq8e7c7qcpp, Id1e31ij0c35fv, Ic6vatc0h2tbq8, I72jcvr86rnvv8, I90c919drss29e, Ifccifqltb5obi, Iadtsfv699cq8b, Ialpmgmhr3gk5r, I4cbvqmqadhrea, I3sdol54kg5jaq, I8fougodaj6di6, I81vt5eq60l4b6, I3vh014cqgmrfd, Ia5cotcvi888ln, I21jsa919m88fd, Iegif7m3upfe1k, I9kt8c221c83ln, Ic76kfh5ebqkpl, Icscpmubum33bq, I21d2olof7eb60, Ibgm4rnf22lal1, Ie68np0vpihith, I9bnv6lu0crf1q, Iauhjqifrdklq7, Ie1uso9m8rt5cf, I40pqum1mu8qg3, I1r4c2ghbtvjuc, I31fb7db4bv6ln, I6prj085oihphp, I44m1vft5l6o06, Iabas7l138cqgj, I6e58ba477s4l4, Iccoh7s156h15i, I3kqaqg9krebsk, Ideaemvoneh309, I3d9o9d7epp66v, I6lqh1vgb4mcja, Iejcklm1m5ig5m, I8k3rnvpeeh4hv, I440d6i17jrfje, I9v6oij2c2ajai, I6hk7temg1mga7, I2lbmfajhc5gdu, I2siheq6f2djrd, I2eb501t8s6hsq, Ianmuoljk2sk1u, I3dqpogh1f1c93, Ic6cqd9g0t65v0, I5sv83ib1q5mod, Ia9mkdf6l44shb, I9l2s4klu0831o, I2ctrt5nqb8o7c, I711qahikocb1c, I6o1er683vod1j, Id6gojh30v9ib2, Ibk29mtr51rukj, Id9uqtigc0il3v, Ic68lsi7chpv5k, Iek0boln8pgnko, I452bkd71b385t, Ie83f0p0ke1f4u, Ib9nmpn9ru9aeh, Ie5l999tf7t2te, I6b6ng21g2eap6, Ia5eqng70q48q6, I79nh52dspn15s, I6viutd279aov3, I6tuqjmsr5ahcq, I8k2cd3v73pgjh, Ia56ucs8f4gubv, Id1vp19i5a7adv, Ic01glfot2319, Ibi23t489qjaej, I6a7ia4g91p320, I7iebj213rflmh, I1c6o7t4005obp, I666bl2fqjkejo, I3sgg3ifcuhgsi, I2t4r3qi2bbfq5, I1kb7l7cim8dam, I9cpejm8q1n41i, Icbccs0ug47ilf, I48li8do1boqsk, I8cj8rnq5f1nol, Idnsos6tvi9tt6, I95p7g3tmk59ap, Ibl1gaa0rn2c67, Id8vsjdockv55e, I4s48t49obgv40, I1b497vgt5ie3v, I5vj4b1eolhu8i, If3trlhj4nhm3u, I8dtsqbl6shss6, Ifpsbvfoe7erus, I4mfip5i7mpjk2, Ic9lb0ksm6bqp9, I3qt1hgg4djhgb, I2254l15dgaup8, I7rcbn8l002fcc, Icpk5dvoekngbe, Iepoo00jurbs3c, I6vn2ukq88hmrf, Iea8e3kkhkfkdo, I2onutgm9avq0n, I4270jaa2l0rr6, Iafscmv8tjf0ou, I4ov6e94l79mbg, Ib5ou59k6na5qv, I7qh4t1qniuepu, Iddfuva7fle38r, Iefam38o91ona9, Ifd8dbgpm7srdt, Ifbug00rch8etj, I28tfrqrmts741, Ievhkup0angt51, I1i6t85s8phv1c, I5os021n9mtdcr, I66tl4phltl6bg, I4t3pgt4ilgpf6, Ifles5ioatcuip, Id2jcn0qee7h6f, Ijgrep2ca50rk, Iasnonvq8v9o5g, I6mk90q9np5nf3, Ichkkipipv6vbf, Ie0n67dnlcbpcf, I1bv5scdc27nbb, I12c2udla9t40g, I4eperb3q65q14, Idpufnltgsuodp, I8lare4sf457ul, I2gt0vglt3agsj, Idjiu7vp8ovdab, I4maqh2jefgv7u, Ibv24s7lkcbv1r, Iadkk9nq2cqqve, I1b55a83kk37g4, Icdnv1iut1hln7, I8a919tojdi2qf, I8en8uvi5isgvj, Ibg509ejf21uui, I59uphia91t9fq, Iagbupr13a1rnf, I497d2v63rjmg, I22bm4d7re21j9, Icnkee0to4c5ac, I7ts20td7b1pmf, I7315hlp5liq47, Ic73rrpct6ckoa, Ib1hmb261fe7mh, I9jfggcqa8oi6c, I437snu8jbuaj2, Ic44opm4fbhp4r, Ia7k5rk3a67fgt, Ie9gieran6hmh7, Ib4o08d7u3o37d, I2l0pq1htsnh8g, Icg4lihlimlj9s, Ie5m07j5sdjl2g, Ibou4u1engb441, Id6nbvqoqdj4o2, I95iqep3b8snn9, Ia82mnkmeo2rhc, Ibmkdg0la4lmik, I1jm8m1rh9e20v, I855j4i3kr8ko1, I1dfctsnhih1bs, Idd7hd99u0ho0n, I100l07kaehdlp, I6gnbnvip5vvdi, Icv68aq8841478, Ic262ibdoec56a, Iflcfm9b6nlmdd, Ijrsf4mnp3eka, Id5fm4p8lj5qgi, I8tjvj9uq4b7hi, I4fooe9dun9o0t, I4t941tu6n95pd, I7a812tlv1a711, I3osgdo4c94kio, Iph9c4rn81ub2, Ier2cke86dqbr2, Ia19q5nd942d8c, Icqe266pmnr25o, I5hoiph0lqphp, I5k7oropl9ofc7, I48vagp1omigob, Ib5tst4ppem1g6, Ibn64edsrg3737, I83r9d02dh47j9, I3jnhifvaeuama, I8n1gia0lo42ok, I6gb0o7lqjfdjq, Idh36v6iegkmpq, I27hnueutmchbe, Iectm2em66uhao, I7q57goff3j72h, Ibe49veu9i9nro, I1rnkmiu7usb82, Iadvnek4gbu68j, Ibtugueatkkr9s, I6felmv64s40c4, I5k7edfft48vsq, Iaeqj2ebnvkjqe, I39t01nnod9109, I6v8sm60vvkmk7, I1qmtmbe5so8r3, Ih99m6ehpcar7, Idgorhsbgdq2ap, I9ubb2kqevnu6t, I2hq50pu2kdjpo, I9acqruh7322g2, I137t1cld92pod, I61d51nv4cou88, If8u5kl4h8070m, Ibmuil6p3vl83l, I7lul91g50ae87, Icl7nl1rfeog3i, Iasr6pj6shs0fl, I2uqmls7kcdnii, Idg69klialbkb8, I7r6b7145022pp, I30pg328m00nr3, Icmrn7bogp28cs, I7m9b5plj4h5ot, I9onhk772nfs4f, I3l6bnksrmt56r, Idh09k0l2pmdcg, I7uoiphbm0tj4r, I512p1n7qt24l8, I6s1nbislhk619, I3gghqnh2mj0is, I6iv852roh6t3h, I9oc2o6itbiopq, Ibslgga81p36aa, I1rvj4ubaplho0, Ia3uu7lqcc1q1i, I7crucfnonitkn, I7tmrp94r9sq4n, I8q7bne2mpmuvt, I4e44onfj09kj9, Iff4dsuaudcmul, I6at1u8h56mk6v, Iep27ialq4a7o7, Iasu5jvoqr43mv, Iip94ct8liqkr, I5qolde99acmd1, I8gtde5abn1g9a, Icanjvelodp3, I5rtkmhm2dng4u, Iquobi9ukq7tb, I4mj21qcksiuf3, I2ur0oeqg495j8, I8v2su1f60qoae, I1bhd210c3phjj, Iep1lmt6q3s6r3, I1fac16213rie2, Ifjt77oc391o43, Itvt1jsipv0lc, Ick3mveut33f44, I719lqkkbtikbl, Ie4intrc3n8jfu, I2rg5btjrsqec0, Ibdqerrooruuq9, I8u2ba9jeiu6q0, I7ieadb293k6b4, I86ooiomatht8n, I7v1eea9s3tjf6, Ifcon2ngg4leli, I7luomlm0cts8l, I53pb13fh9bdtb, I5eoknm3d4b0hp, I1267r4okm030g, I7v53d8lg25u6e, Ie732hi40q3bng, I4auq2rk2vmnof, I36d2sa03ne4gv, Id0mmcnagcakpt, I3fn79iu085nho, I1qepegjhn0439, I3g1h0napekm89, Ib4r095rdf5mqu, I816g8dafh3n9m, I5rguq5hs7ae5g, Id0n15ml7mlce1, I95dvhl27mlrti, I6mojmjujt2q9u, I3j43dj5855fif, I9m7e67l1rvair, I2fsu027d9jn8p, I1858d79avs8nu, I4dge44jia159s, I7uvflbq4g7rn, Icpl0grufrj09l, Ibi26id9j1t520, Irboug90jv3o0, I33d7cg3ci0742, I8s2eo7q9t6vgf, Ieitag1fl7hkds, Ie060ubkeme5vs, I58bu3hm7657hm, Icc0fkkhtd78sc, I9vf1so75dnrom, I9hg8vptgbqai, I16m4f7hclkkad, I5dvnb65dm4f56, I2abip8j5bmg27, Ickpn0png35631, I3ns5kg6jo268n, I7hu7hl7r35nrm, Ia783as0f2ls27, I298u2lqese6h0, I4c20l83g9496a, I4gp88defd7an, Id113tpicu8sh3, I6ceb7pmur4hki, Ie2d9d2u1qa7ro, Iebdi09jg1ifvr, I5kek6hgenovr0, I91tbphb2dk7gn, I5509mqtnio180, Ifojd05k7ogo8n, I2h93i19beq4qk, I4lmgf1qe39res, Igvk3mrc51o9l, I37r4bdai8o9mp, Ifrvjscp9m1e73, Iamcee9e6bogsv, I2e1ek76m34991, I50aksks5it5n0, Icc5o3lh1v2smd, I5srndmgodi29b, Idd6sihggmv1dq, I1obalebkt2h11, I2gbrv9jm3ucsu, I9pgrv71u9hf6c, Ib2kb4gr1v6eis, Ib52ld1ackp05u, I619o495nctj82, If1co0pilmi7oq, Iae74gjak1qibn, I3escdojpj0551, I5r8t4iaend96p, I6052turo9tavh, I35p85j063s0il, Iemk0s5gdc9ruv, Ierfo0k32c1e50, Ieuemnllefri8h, Iavc33atjrmdmp, I596b7bbfu4tap, I4arjljr6dpflb, Ia4n949ohqh8lm, I9vodnt2k1kha, I4ao1le27fcisl, Ih4ursllob8fg, Iaqet9jc3ihboe, Ic952bubvq4k7d, I2v50gu3s1aqk6, Iabpgqcjikia83, I4gil44d08grh, I7u915mvkdsb08, I4s8jc79vpdfj8, If7uv525tdvv7a, I2an1fs2eiebjp, TransactionValidityTransactionSource, I9ask1o4tfvcvs, I4ph3d1eepnmr1, Icerf8h8pdu8ss, I6spmpef2c7svf, Iei2mvq0mjvt81, Iftvbctbo05fu4, XcmVersionedXcm, Ic0c3req3mlc1l, XcmVersionedAssetId, I7ocn4njqde3v5, Iek7ha36da9mf5, I2vjn8o312puvk, I1nnit8gqdhb62, I60k51mebtj8tr, Ieh6nis3hdbtgi, Ic1d4u2opv3fst, Ie9sr1iqcg3cgm, I1mqgk2tmnn9i2, I6lr8sctk0bi4e, I40k710moo3ghm, Id3vovj0ihlrsb, I6i9m7o2et1j4d, I4rnuci7kia2r1, I6k0juar2doko8, I9187oseptvbg4, Id5fnv3e135pfi, I7ohvr4mqgjtpu, I1aakk85jiarum, Ie5q72utgevbaq, I8rjgvnsb8ltnm } from "./common-types";
type AnonymousEnum<T extends {}> = T & {
    __anonymous: true;
};
type MyTuple<T> = [T, ...T[]];
type SeparateUndefined<T> = undefined extends T ? undefined | Exclude<T, undefined> : T;
type Anonymize<T> = SeparateUndefined<T extends string | number | bigint | boolean | void | undefined | null | symbol | Uint8Array | Enum<any> ? T : T extends AnonymousEnum<infer V> ? Enum<V> : T extends MyTuple<any> ? {
    [K in keyof T]: T[K];
} : T extends [] ? [] : T extends FixedSizeArray<infer L, infer T> ? number extends L ? Array<T> : FixedSizeArray<L, T> : {
    [K in keyof T & string]: T[K];
}>;
type IStorage = {
    System: {
        /**
         * The full account information for a particular account ID.
         */
        Account: StorageDescriptor<[Key: SS58String], Anonymize<I5sesotjlssv2d>, false, never>;
        /**
         * Total extrinsics count for the current block.
         */
        ExtrinsicCount: StorageDescriptor<[], number, true, never>;
        /**
         * Whether all inherents have been applied.
         */
        InherentsApplied: StorageDescriptor<[], boolean, false, never>;
        /**
         * The current weight for the block.
         */
        BlockWeight: StorageDescriptor<[], Anonymize<Iffmde3ekjedi9>, false, never>;
        /**
         * Total size (in bytes) of the current block.
         *
         * Tracks the size of the header and all extrinsics.
         */
        BlockSize: StorageDescriptor<[], number, true, never>;
        /**
         * Map of block numbers to block hashes.
         */
        BlockHash: StorageDescriptor<[Key: number], SizedHex<32>, false, never>;
        /**
         * Extrinsics data for the current block (maps an extrinsic's index to its data).
         */
        ExtrinsicData: StorageDescriptor<[Key: number], Uint8Array, false, never>;
        /**
         * The current block number being processed. Set by `execute_block`.
         */
        Number: StorageDescriptor<[], number, false, never>;
        /**
         * Hash of the previous block.
         */
        ParentHash: StorageDescriptor<[], SizedHex<32>, false, never>;
        /**
         * Digest of the current block, also part of the block header.
         */
        Digest: StorageDescriptor<[], Anonymize<I4mddgoa69c0a2>, false, never>;
        /**
         * Events deposited for the current block.
         *
         * NOTE: The item is unbound and should therefore never be read on chain.
         * It could otherwise inflate the PoV size of a block.
         *
         * Events have a large in-memory size. Box the events to not go out-of-memory
         * just in case someone still reads them from within the runtime.
         */
        Events: StorageDescriptor<[], Anonymize<I3v2vo485iral6>, false, never>;
        /**
         * The number of events in the `Events<T>` list.
         */
        EventCount: StorageDescriptor<[], number, false, never>;
        /**
         * Mapping between a topic (represented by T::Hash) and a vector of indexes
         * of events in the `<Events<T>>` list.
         *
         * All topic vectors have deterministic storage locations depending on the topic. This
         * allows light-clients to leverage the changes trie storage tracking mechanism and
         * in case of changes fetch the list of events of interest.
         *
         * The value has the type `(BlockNumberFor<T>, EventIndex)` because if we used only just
         * the `EventIndex` then in case if the topic has the same contents on the next block
         * no notification will be triggered thus the event might be lost.
         */
        EventTopics: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I95g6i7ilua7lq>, false, never>;
        /**
         * Stores the `spec_version` and `spec_name` of when the last runtime upgrade happened.
         */
        LastRuntimeUpgrade: StorageDescriptor<[], Anonymize<Ieniouoqkq4icf>, true, never>;
        /**
         * Number of blocks till the pending code upgrade is applied.
         */
        BlocksTillUpgrade: StorageDescriptor<[], number, true, never>;
        /**
         * True if we have upgraded so that `type RefCount` is `u32`. False (default) if not.
         */
        UpgradedToU32RefCount: StorageDescriptor<[], boolean, false, never>;
        /**
         * True if we have upgraded so that AccountInfo contains three types of `RefCount`. False
         * (default) if not.
         */
        UpgradedToTripleRefCount: StorageDescriptor<[], boolean, false, never>;
        /**
         * The execution phase of the block.
         */
        ExecutionPhase: StorageDescriptor<[], Phase, true, never>;
        /**
         * `Some` if a code upgrade has been authorized.
         */
        AuthorizedUpgrade: StorageDescriptor<[], Anonymize<Ibgl04rn6nbfm6>, true, never>;
        /**
         * The weight reclaimed for the extrinsic.
         *
         * This information is available until the end of the extrinsic execution.
         * More precisely this information is removed in `note_applied_extrinsic`.
         *
         * Logic doing some post dispatch weight reduction must update this storage to avoid duplicate
         * reduction.
         */
        ExtrinsicWeightReclaimed: StorageDescriptor<[], Anonymize<I4q39t5hn830vp>, false, never>;
    };
    ParachainSystem: {
        /**
         * The current block weight mode.
         *
         * This is used to determine what is the maximum allowed block weight, for more information see
         * [`block_weight`].
         *
         * Killed in [`Self::on_initialize`] and set by the [`block_weight`] logic.
         */
        BlockWeightMode: StorageDescriptor<[], Anonymize<I8re9183nrhr3n>, true, never>;
        /**
         * The core count available to the parachain in the previous block.
         *
         * This is mainly used for offchain functionality to calculate the correct target block weight.
         */
        PreviousCoreCount: StorageDescriptor<[], number, true, never>;
        /**
         * Latest included block descendants the runtime accepted. In other words, these are
         * ancestors of the currently executing block which have not been included in the observed
         * relay-chain state.
         *
         * The segment length is limited by the capacity returned from the [`ConsensusHook`] configured
         * in the pallet.
         */
        UnincludedSegment: StorageDescriptor<[], Anonymize<I1v7jbnil3tjns>, false, never>;
        /**
         * Storage field that keeps track of bandwidth used by the unincluded segment along with the
         * latest HRMP watermark. Used for limiting the acceptance of new blocks with
         * respect to relay chain constraints.
         */
        AggregatedUnincludedSegment: StorageDescriptor<[], Anonymize<I8jgj1nhcr2dg8>, true, never>;
        /**
         * In case of a scheduled upgrade, this storage field contains the validation code to be
         * applied.
         *
         * As soon as the relay chain gives us the go-ahead signal, we will overwrite the
         * [`:pending_code`][sp_core::storage::well_known_keys::PENDING_CODE] which will result the
         * next block to be processed with the new validation code. This concludes the upgrade process.
         */
        PendingValidationCode: StorageDescriptor<[], Uint8Array, false, never>;
        /**
         * Validation code that is set by the parachain and is to be communicated to collator and
         * consequently the relay-chain.
         *
         * This will be cleared in `on_initialize` of each new block if no other pallet already set
         * the value.
         */
        NewValidationCode: StorageDescriptor<[], Uint8Array, true, never>;
        /**
         * The [`PersistedValidationData`] set for this block.
         *
         * This value is expected to be set only once by the [`Pallet::set_validation_data`] inherent.
         */
        ValidationData: StorageDescriptor<[], Anonymize<Ifn6q3equiq9qi>, true, never>;
        /**
         * Were the validation data set to notify the relay chain?
         */
        DidSetValidationCode: StorageDescriptor<[], boolean, false, never>;
        /**
         * The relay chain block number associated with the last parachain block.
         *
         * This is updated in `on_finalize`.
         */
        LastRelayChainBlockNumber: StorageDescriptor<[], number, false, never>;
        /**
         * An option which indicates if the relay-chain restricts signalling a validation code upgrade.
         * In other words, if this is `Some` and [`NewValidationCode`] is `Some` then the produced
         * candidate will be invalid.
         *
         * This storage item is a mirror of the corresponding value for the current parachain from the
         * relay-chain. This value is ephemeral which means it doesn't hit the storage. This value is
         * set after the inherent.
         */
        UpgradeRestrictionSignal: StorageDescriptor<[], Anonymize<Ia3sb0vgvovhtg>, false, never>;
        /**
         * Optional upgrade go-ahead signal from the relay-chain.
         *
         * This storage item is a mirror of the corresponding value for the current parachain from the
         * relay-chain. This value is ephemeral which means it doesn't hit the storage. This value is
         * set after the inherent.
         */
        UpgradeGoAhead: StorageDescriptor<[], Anonymize<Iav8k1edbj86k7>, false, never>;
        /**
         * The state proof for the last relay parent block.
         *
         * This field is meant to be updated each block with the validation data inherent. Therefore,
         * before processing of the inherent, e.g. in `on_initialize` this data may be stale.
         *
         * This data is also absent from the genesis.
         */
        RelayStateProof: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, true, never>;
        /**
         * The snapshot of some state related to messaging relevant to the current parachain as per
         * the relay parent.
         *
         * This field is meant to be updated each block with the validation data inherent. Therefore,
         * before processing of the inherent, e.g. in `on_initialize` this data may be stale.
         *
         * This data is also absent from the genesis.
         */
        RelevantMessagingState: StorageDescriptor<[], Anonymize<I4i91h98n3cv1b>, true, never>;
        /**
         * The parachain host configuration that was obtained from the relay parent.
         *
         * This field is meant to be updated each block with the validation data inherent. Therefore,
         * before processing of the inherent, e.g. in `on_initialize` this data may be stale.
         *
         * This data is also absent from the genesis.
         */
        HostConfiguration: StorageDescriptor<[], Anonymize<I4iumukclgj8ej>, true, never>;
        /**
         * The last downward message queue chain head we have observed.
         *
         * This value is loaded before and saved after processing inbound downward messages carried
         * by the system inherent.
         */
        LastDmqMqcHead: StorageDescriptor<[], SizedHex<32>, false, never>;
        /**
         * The message queue chain heads we have observed per each channel incoming channel.
         *
         * This value is loaded before and saved after processing inbound downward messages carried
         * by the system inherent.
         */
        LastHrmpMqcHeads: StorageDescriptor<[], Anonymize<Iqnbvitf7a7l3>, false, never>;
        /**
         * Number of downward messages processed in a block.
         *
         * This will be cleared in `on_initialize` of each new block.
         */
        ProcessedDownwardMessages: StorageDescriptor<[], number, false, never>;
        /**
         * The last processed downward message.
         *
         * We need to keep track of this to filter the messages that have been already processed.
         */
        LastProcessedDownwardMessage: StorageDescriptor<[], Anonymize<I48i407regf59r>, true, never>;
        /**
         * HRMP watermark that was set in a block.
         */
        HrmpWatermark: StorageDescriptor<[], number, false, never>;
        /**
         * The last processed HRMP message.
         *
         * We need to keep track of this to filter the messages that have been already processed.
         */
        LastProcessedHrmpMessage: StorageDescriptor<[], Anonymize<I48i407regf59r>, true, never>;
        /**
         * HRMP messages that were sent in a block.
         *
         * This will be cleared in `on_initialize` of each new block.
         */
        HrmpOutboundMessages: StorageDescriptor<[], Anonymize<I6r5cbv8ttrb09>, false, never>;
        /**
         * Upward messages that were sent in a block.
         *
         * This will be cleared in `on_initialize` for each new block.
         */
        UpwardMessages: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, false, never>;
        /**
         * Upward messages that are still pending and not yet sent to the relay chain.
         */
        PendingUpwardMessages: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, false, never>;
        /**
         * Upward signals that are still pending and not yet sent to the relay chain.
         *
         * This will be cleared in `on_finalize` for each block.
         */
        PendingUpwardSignals: StorageDescriptor<[], Anonymize<Itom7fk49o0c9>, false, never>;
        /**
         * The approved peer id to be sent as a UMP signal on the last block of the PoV.
         */
        PendingApprovedPeer: StorageDescriptor<[], Uint8Array, true, never>;
        /**
         * The factor to multiply the base delivery fee by for UMP.
         */
        UpwardDeliveryFeeFactor: StorageDescriptor<[], bigint, false, never>;
        /**
         * The number of HRMP messages we observed in `on_initialize` and thus used that number for
         * announcing the weight of `on_initialize` and `on_finalize`.
         */
        AnnouncedHrmpMessagesPerCandidate: StorageDescriptor<[], number, false, never>;
        /**
         * The weight we reserve at the beginning of the block for processing XCMP messages. This
         * overrides the amount set in the Config trait.
         */
        ReservedXcmpWeightOverride: StorageDescriptor<[], Anonymize<I4q39t5hn830vp>, true, never>;
        /**
         * The weight we reserve at the beginning of the block for processing DMP messages. This
         * overrides the amount set in the Config trait.
         */
        ReservedDmpWeightOverride: StorageDescriptor<[], Anonymize<I4q39t5hn830vp>, true, never>;
        /**
         * A custom head data that should be returned as result of `validate_block`.
         *
         * See `Pallet::set_custom_validation_head_data` for more information.
         */
        CustomValidationHeadData: StorageDescriptor<[], Uint8Array, true, never>;
        /**
         * Tracks cumulative `UMP` and `HRMP` messages sent across blocks in the current `PoV`.
         *
         * Across different candidates/PoVs the budgets are tracked by [`AggregatedUnincludedSegment`].
         */
        PoVMessagesTracker: StorageDescriptor<[], Anonymize<Inofn0qqbjtb9>, true, never>;
    };
    Timestamp: {
        /**
         * The current time for the current block.
         */
        Now: StorageDescriptor<[], bigint, false, never>;
        /**
         * Whether the timestamp has been updated in this block.
         *
         * This value is updated to `true` upon successful submission of a timestamp by a node.
         * It is then checked at the end of each block execution in the `on_finalize` hook.
         */
        DidUpdate: StorageDescriptor<[], boolean, false, never>;
    };
    ParachainInfo: {
        /**
        
         */
        ParachainId: StorageDescriptor<[], number, false, never>;
    };
    Balances: {
        /**
         * The total units issued in the system.
         */
        TotalIssuance: StorageDescriptor<[], bigint, false, never>;
        /**
         * The total units of outstanding deactivated balance in the system.
         */
        InactiveIssuance: StorageDescriptor<[], bigint, false, never>;
        /**
         * The Balances pallet example of storing the balance of an account.
         *
         * # Example
         *
         * ```nocompile
         * impl pallet_balances::Config for Runtime {
         * type AccountStore = StorageMapShim<Self::Account<Runtime>, frame_system::Provider<Runtime>, AccountId, Self::AccountData<Balance>>
         * }
         * ```
         *
         * You can also store the balance of an account in the `System` pallet.
         *
         * # Example
         *
         * ```nocompile
         * impl pallet_balances::Config for Runtime {
         * type AccountStore = System
         * }
         * ```
         *
         * But this comes with tradeoffs, storing account balances in the system pallet stores
         * `frame_system` data alongside the account data contrary to storing account balances in the
         * `Balances` pallet, which uses a `StorageMap` to store balances data only.
         * NOTE: This is only used in the case that this pallet is used to store balances.
         */
        Account: StorageDescriptor<[Key: SS58String], Anonymize<I1q8tnt1cluu5j>, false, never>;
        /**
         * Any liquidity locks on some account balances.
         * NOTE: Should only be accessed when setting, changing and freeing a lock.
         *
         * Use of locks is deprecated in favour of freezes. See `https://github.com/paritytech/substrate/pull/12951/`
         */
        Locks: StorageDescriptor<[Key: SS58String], Anonymize<I8ds64oj6581v0>, false, never>;
        /**
         * Named reserves on some account balances.
         *
         * Use of reserves is deprecated in favour of holds. See `https://github.com/paritytech/substrate/pull/12951/`
         */
        Reserves: StorageDescriptor<[Key: SS58String], Anonymize<Ia7pdug7cdsg8g>, false, never>;
        /**
         * Holds on account balances.
         */
        Holds: StorageDescriptor<[Key: SS58String], Anonymize<Iff83br6to6vp5>, false, never>;
        /**
         * Freeze locks on account balances.
         */
        Freezes: StorageDescriptor<[Key: SS58String], Anonymize<I9bin2jc70qt6q>, false, never>;
    };
    TransactionPayment: {
        /**
        
         */
        NextFeeMultiplier: StorageDescriptor<[], bigint, false, never>;
        /**
        
         */
        StorageVersion: StorageDescriptor<[], TransactionPaymentReleases, false, never>;
        /**
         * The `OnChargeTransaction` stores the withdrawn tx fee here.
         *
         * Use `withdraw_txfee` and `remaining_txfee` to access from outside the crate.
         */
        TxPaymentCredit: StorageDescriptor<[], bigint, true, never>;
    };
    OriginRestriction: {
        /**
         * The current usage for each entity.
         */
        Usages: StorageDescriptor<[Key: Anonymize<I8arc778cv9pqq>], Anonymize<Icj0tssrh6ika3>, true, never>;
    };
    Assets: {
        /**
         * Details of an asset.
         */
        Asset: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], Anonymize<I3qklfjubrljqh>, true, never>;
        /**
         * The holdings of a specific account for a specific asset.
         */
        Account: StorageDescriptor<Anonymize<I4v5g6i7bmt06o>, Anonymize<Iag3f1hum3p4c8>, true, never>;
        /**
         * Approved balance transfers. First balance is the amount approved for transfer. Second
         * is the amount of `T::Currency` reserved for storing this.
         * First key is the asset ID, second key is the owner and third key is the delegate.
         */
        Approvals: StorageDescriptor<Anonymize<I84bhscllvv07n>, Anonymize<I4s6jkha20aoh0>, true, never>;
        /**
         * Metadata of an asset.
         */
        Metadata: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], Anonymize<I78s05f59eoi8b>, false, never>;
        /**
         * Maps an asset to a list of its configured reserve information.
         */
        Reserves: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], Anonymize<If2801grpltbp8>, false, never>;
        /**
         * The asset ID enforced for the next asset creation, if any present. Otherwise, this storage
         * item has no effect.
         *
         * This can be useful for setting up constraints for IDs of the new assets. For example, by
         * providing an initial [`NextAssetId`] and using the [`crate::AutoIncAssetId`] callback, an
         * auto-increment model can be applied to all new asset IDs.
         *
         * The initial next asset ID can be set using the [`GenesisConfig`] or the
         * [SetNextAssetId](`migration::next_asset_id::SetNextAssetId`) migration.
         */
        NextAssetId: StorageDescriptor<[], Anonymize<If9iqq7i64mur8>, true, never>;
    };
    AssetsHolder: {
        /**
         * A map that stores holds applied on an account for a given AssetId.
         */
        Holds: StorageDescriptor<Anonymize<I4v5g6i7bmt06o>, Anonymize<Iff83br6to6vp5>, false, never>;
        /**
         * A map that stores the current total balance on hold for every account on a given AssetId.
         */
        BalancesOnHold: StorageDescriptor<Anonymize<I4v5g6i7bmt06o>, bigint, true, never>;
    };
    AssetRate: {
        /**
         * Maps an asset to its fixed point representation in the native balance.
         *
         * E.g. `native_amount = asset_amount * ConversionRateToNative::<T>::get(asset_kind)`
         */
        ConversionRateToNative: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], bigint, true, never>;
    };
    Authorship: {
        /**
         * Author of current block.
         */
        Author: StorageDescriptor<[], SS58String, true, never>;
    };
    CollatorSelection: {
        /**
         * The invulnerable, permissioned collators. This list must be sorted.
         */
        Invulnerables: StorageDescriptor<[], Anonymize<Ia2lhg7l2hilo3>, false, never>;
        /**
         * The (community, limited) collation candidates. `Candidates` and `Invulnerables` should be
         * mutually exclusive.
         *
         * This list is sorted in ascending order by deposit and when the deposits are equal, the least
         * recently updated is considered greater.
         */
        CandidateList: StorageDescriptor<[], Anonymize<Ifi4da1gej1fri>, false, never>;
        /**
         * Last block authored by collator.
         */
        LastAuthoredBlock: StorageDescriptor<[Key: SS58String], number, false, never>;
        /**
         * Desired number of candidates.
         *
         * This should ideally always be less than [`Config::MaxCandidates`] for weights to be correct.
         */
        DesiredCandidates: StorageDescriptor<[], number, false, never>;
        /**
         * Fixed amount to deposit to become a collator.
         *
         * When a collator calls `leave_intent` they immediately receive the deposit back.
         */
        CandidacyBond: StorageDescriptor<[], bigint, false, never>;
    };
    Session: {
        /**
         * The current set of validators.
         */
        Validators: StorageDescriptor<[], Anonymize<Ia2lhg7l2hilo3>, false, never>;
        /**
         * Current index of the session.
         */
        CurrentIndex: StorageDescriptor<[], number, false, never>;
        /**
         * True if the underlying economic identities or weighting behind the validators
         * has changed in the queued validator set.
         */
        QueuedChanged: StorageDescriptor<[], boolean, false, never>;
        /**
         * The queued keys for the next session. When the next session begins, these keys
         * will be used to determine the validator's session keys.
         */
        QueuedKeys: StorageDescriptor<[], Anonymize<Ifvgo9568rpmqc>, false, never>;
        /**
         * Indices of disabled validators.
         *
         * The vec is always kept sorted so that we can find whether a given validator is
         * disabled using binary search. It gets cleared when `on_session_ending` returns
         * a new set of identities.
         */
        DisabledValidators: StorageDescriptor<[], Anonymize<I95g6i7ilua7lq>, false, never>;
        /**
         * The next session keys for a validator.
         */
        NextKeys: StorageDescriptor<[Key: SS58String], SizedHex<32>, true, never>;
        /**
         * The owner of a key. The key is the `KeyTypeId` + the encoded key.
         */
        KeyOwner: StorageDescriptor<[Key: Anonymize<I82jm9g7pufuel>], SS58String, true, never>;
        /**
         * Accounts whose keys were set via `SessionInterface` (external path) without
         * incrementing the consumer reference or placing a key deposit. `do_purge_keys`
         * only decrements consumers for accounts that were registered through the local
         * session pallet.
         */
        ExternallySetKeys: StorageDescriptor<[Key: SS58String], null, true, never>;
    };
    Aura: {
        /**
         * The current authority set.
         */
        Authorities: StorageDescriptor<[], Anonymize<Ic5m5lp1oioo8r>, false, never>;
        /**
         * The current slot of this block.
         *
         * This will be set in `on_initialize`.
         */
        CurrentSlot: StorageDescriptor<[], bigint, false, never>;
    };
    AuraExt: {
        /**
         * Serves as cache for the authorities.
         *
         * The authorities in AuRa are overwritten in `on_initialize` when we switch to a new session,
         * but we require the old authorities to verify the seal when validating a PoV. This will
         * always be updated to the latest AuRa authorities in `on_finalize`.
         */
        Authorities: StorageDescriptor<[], Anonymize<Ic5m5lp1oioo8r>, false, never>;
        /**
         * Current relay chain slot paired with a number of authored blocks.
         *
         * This is updated in [`FixedVelocityConsensusHook::on_state_proof`] with the current relay
         * chain slot as provided by the relay chain state proof.
         */
        RelaySlotInfo: StorageDescriptor<[], Anonymize<I6cs1itejju2vv>, true, never>;
    };
    XcmpQueue: {
        /**
         * The suspended inbound XCMP channels. All others are not suspended.
         *
         * This is a `StorageValue` instead of a `StorageMap` since we expect multiple reads per block
         * to different keys with a one byte payload. The access to `BoundedBTreeSet` will be cached
         * within the block and therefore only included once in the proof size.
         *
         * NOTE: The PoV benchmarking cannot know this and will over-estimate, but the actual proof
         * will be smaller.
         */
        InboundXcmpSuspended: StorageDescriptor<[], Anonymize<Icgljjb6j82uhn>, false, never>;
        /**
         * The non-empty XCMP channels in order of becoming non-empty, and the index of the first
         * and last outbound message. If the two indices are equal, then it indicates an empty
         * queue and there must be a non-`Ok` `OutboundStatus`. We assume queues grow no greater
         * than 65535 items. Queue indices for normal messages begin at one; zero is reserved in
         * case of the need to send a high-priority signal message this block.
         * The bool is true if there is a signal message waiting to be sent.
         */
        OutboundXcmpStatus: StorageDescriptor<[], Anonymize<I9pvau8qut93lg>, false, never>;
        /**
         * The messages outbound in a given XCMP channel.
         */
        OutboundXcmpMessages: StorageDescriptor<Anonymize<I5g2vv0ckl2m8b>, Uint8Array, false, never>;
        /**
         * Any signal messages waiting to be sent.
         */
        SignalMessages: StorageDescriptor<[Key: number], Uint8Array, false, never>;
        /**
         * The configuration which controls the dynamics of the outbound queue.
         */
        QueueConfig: StorageDescriptor<[], Anonymize<Ifup3lg9ro8a0f>, false, never>;
        /**
         * Whether or not the XCMP queue is suspended from executing incoming XCMs or not.
         */
        QueueSuspended: StorageDescriptor<[], boolean, false, never>;
        /**
         * The factor to multiply the base delivery fee by.
         */
        DeliveryFeeFactor: StorageDescriptor<[Key: number], bigint, false, never>;
    };
    PolkadotXcm: {
        /**
         * The latest available query index.
         */
        QueryCounter: StorageDescriptor<[], bigint, false, never>;
        /**
         * The ongoing queries.
         */
        Queries: StorageDescriptor<[Key: bigint], Anonymize<I5qfubnuvrnqn6>, true, never>;
        /**
         * The existing asset traps.
         *
         * Key is the blake2 256 hash of (origin, versioned `Assets`) pair. Value is the number of
         * times this pair has been trapped (usually just 1 if it exists at all).
         */
        AssetTraps: StorageDescriptor<[Key: SizedHex<32>], number, false, never>;
        /**
         * Default version to encode XCM when latest version of destination is unknown. If `None`,
         * then the destinations whose XCM version is unknown are considered unreachable.
         */
        SafeXcmVersion: StorageDescriptor<[], number, true, never>;
        /**
         * The Latest versions that we know various locations support.
         */
        SupportedVersion: StorageDescriptor<Anonymize<I8t3u2dv73ahbd>, number, true, never>;
        /**
         * All locations that we have requested version notifications from.
         */
        VersionNotifiers: StorageDescriptor<Anonymize<I8t3u2dv73ahbd>, bigint, true, never>;
        /**
         * The target locations that are subscribed to our version changes, as well as the most recent
         * of our versions we informed them of.
         */
        VersionNotifyTargets: StorageDescriptor<Anonymize<I8t3u2dv73ahbd>, Anonymize<I7vlvrrl2pnbgk>, true, never>;
        /**
         * Destinations whose latest XCM version we would like to know. Duplicates not allowed, and
         * the `u32` counter is the number of times that a send to the destination has been attempted,
         * which is used as a prioritization.
         */
        VersionDiscoveryQueue: StorageDescriptor<[], Anonymize<Ie0rpl5bahldfk>, false, never>;
        /**
         * The current migration's stage, if any.
         */
        CurrentMigration: StorageDescriptor<[], XcmPalletVersionMigrationStage, true, never>;
        /**
         * Fungible assets which we know are locked on a remote chain.
         */
        RemoteLockedFungibles: StorageDescriptor<Anonymize<Ie849h3gncgvok>, Anonymize<I7e5oaj2qi4kl1>, true, never>;
        /**
         * Fungible assets which we know are locked on this chain.
         */
        LockedFungibles: StorageDescriptor<[Key: SS58String], Anonymize<Iat62vud7hlod2>, true, never>;
        /**
         * Global suspension state of the XCM executor.
         */
        XcmExecutionSuspended: StorageDescriptor<[], boolean, false, never>;
        /**
         * Whether or not incoming XCMs (both executed locally and received) should be recorded.
         * Only one XCM program will be recorded at a time.
         * This is meant to be used in runtime APIs, and it's advised it stays false
         * for all other use cases, so as to not degrade regular performance.
         *
         * Only relevant if this pallet is being used as the [`xcm_executor::traits::RecordXcm`]
         * implementation in the XCM executor configuration.
         */
        ShouldRecordXcm: StorageDescriptor<[], boolean, false, never>;
        /**
         * If [`ShouldRecordXcm`] is set to true, then the last XCM program executed locally
         * will be stored here.
         * Runtime APIs can fetch the XCM that was executed by accessing this value.
         *
         * Only relevant if this pallet is being used as the [`xcm_executor::traits::RecordXcm`]
         * implementation in the XCM executor configuration.
         */
        RecordedXcm: StorageDescriptor<[], Anonymize<Ict03eedr8de9s>, true, never>;
        /**
         * Map of authorized aliasers of local origins. Each local location can authorize a list of
         * other locations to alias into it. Each aliaser is only valid until its inner `expiry`
         * block number.
         */
        AuthorizedAliases: StorageDescriptor<[Key: XcmVersionedLocation], Anonymize<Ici7ejds60vj52>, true, never>;
    };
    MessageQueue: {
        /**
         * The index of the first and last (non-empty) pages.
         */
        BookStateFor: StorageDescriptor<[Key: Anonymize<Iejeo53sea6n4q>], Anonymize<Idh2ug6ou4a8og>, false, never>;
        /**
         * The origin at which we should begin servicing.
         */
        ServiceHead: StorageDescriptor<[], Anonymize<Iejeo53sea6n4q>, true, never>;
        /**
         * The map of page indices to pages.
         */
        Pages: StorageDescriptor<Anonymize<Ib4jhb8tt3uung>, Anonymize<I53esa2ms463bk>, true, never>;
    };
    Multisig: {
        /**
         * The set of open multisig operations.
         */
        Multisigs: StorageDescriptor<Anonymize<I8uo3fpd3bcc6f>, Anonymize<Iag146hmjgqfgj>, true, never>;
    };
    Sudo: {
        /**
         * The `AccountId` of the sudo key.
         */
        Key: StorageDescriptor<[], SS58String, true, never>;
    };
    Proxy: {
        /**
         * The set of account proxies. Maps the account which has delegated to the accounts
         * which are being delegated to, together with the amount held on deposit.
         */
        Proxies: StorageDescriptor<[Key: SS58String], Anonymize<I48e2fe747rjco>, false, never>;
        /**
         * The announcements made by the proxy (key).
         */
        Announcements: StorageDescriptor<[Key: SS58String], Anonymize<I9p9lq3rej5bhc>, false, never>;
    };
    Identity: {
        /**
         * Information that is pertinent to identify the entity behind an account. First item is the
         * registration, second is the account's primary username.
         *
         * TWOX-NOTE: OK ― `AccountId` is a secure hash.
         */
        IdentityOf: StorageDescriptor<[Key: SS58String], Anonymize<I8sp8i1c9u7kvv>, true, never>;
        /**
         * Identifies the primary username of an account.
         */
        UsernameOf: StorageDescriptor<[Key: SS58String], Uint8Array, true, never>;
        /**
         * The super-identity of an alternative "sub" identity together with its name, within that
         * context. If the account is not some other account's sub-identity, then just `None`.
         */
        SuperOf: StorageDescriptor<[Key: SS58String], Anonymize<I910puuahutflf>, true, never>;
        /**
         * Alternative "sub" identities of this account.
         *
         * The first item is the deposit, the second is a vector of the accounts.
         *
         * TWOX-NOTE: OK ― `AccountId` is a secure hash.
         */
        SubsOf: StorageDescriptor<[Key: SS58String], Anonymize<I4nfjdef0ibh44>, false, never>;
        /**
         * The set of registrars. Not expected to get very big as can only be added through a
         * special origin (likely a council motion).
         *
         * The index into this can be cast to `RegistrarIndex` to get a valid value.
         */
        Registrars: StorageDescriptor<[], Anonymize<I74af64m08r6as>, false, never>;
        /**
         * A map of the accounts who are authorized to grant usernames.
         */
        AuthorityOf: StorageDescriptor<[Key: Uint8Array], Anonymize<Ic8ann3kre6vdm>, true, never>;
        /**
         * Reverse lookup from `username` to the `AccountId` that has registered it and the provider of
         * the username. The `owner` value should be a key in the `UsernameOf` map, but it may not if
         * the user has cleared their username or it has been removed.
         *
         * Multiple usernames may map to the same `AccountId`, but `UsernameOf` will only map to one
         * primary username.
         */
        UsernameInfoOf: StorageDescriptor<[Key: Uint8Array], Anonymize<I1j72qfgdejqsv>, true, never>;
        /**
         * Usernames that an authority has granted, but that the account controller has not confirmed
         * that they want it.
         *
         * Used primarily in cases where the `AccountId` cannot provide a signature
         * because they are a pure proxy, multisig, etc. In order to confirm it, they should call
         * [accept_username](`Call::accept_username`).
         *
         * First tuple item is the account and second is the acceptance deadline.
         */
        PendingUsernames: StorageDescriptor<[Key: Uint8Array], Anonymize<I60biiepd74113>, true, never>;
        /**
         * Usernames for which the authority that granted them has started the removal process by
         * unbinding them. Each unbinding username maps to its grace period expiry, which is the first
         * block in which the username could be deleted through a
         * [remove_username](`Call::remove_username`) call.
         */
        UnbindingUsernames: StorageDescriptor<[Key: Uint8Array], number, true, never>;
        /**
         * The metadata associated with a person through their contextual alias for the purposes of
         * registering identity information.
         */
        PersonIdentities: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I2skcsqibb3i2k>, true, never>;
        /**
         * Reverse lookup of accounts controlled by a person through a contextual alias. All people
         * that registered an identity must also associate an on-chain account to it.
         */
        AccountToAlias: StorageDescriptor<[Key: SS58String], SizedHex<32>, true, never>;
        /**
         * Stores pending reports of usernames.
         */
        PendingUsernameReports: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I4ekkp6f1d7a69>, true, never>;
    };
    People: {
        /**
         * The current individuals we recognise, but not necessarily yet included in a ring.
         *
         * Look-up from the crypto (public) key to the immutable ID of the individual (`PersonalId`). A
         * person can have two different entries in this map if they queued a key migration which
         * hasn't been enacted yet.
         */
        Keys: StorageDescriptor<[Key: SizedHex<32>], bigint, true, never>;
        /**
         * Counter for the related counted storage map
         */
        CounterForKeys: StorageDescriptor<[], number, false, never>;
        /**
         * The current individuals we recognise, but not necessarily yet included in a ring.
         *
         * Immutable ID of the individual (`PersonalId`) to information about their key and status.
         */
        People: StorageDescriptor<[Key: bigint], Anonymize<Ifpolrv9bn0ss8>, true, never>;
        /**
         * Conversion of a contextual alias to an account ID.
         */
        AliasToAccount: StorageDescriptor<[Key: Anonymize<Icq9999ubti4jr>], SS58String, true, never>;
        /**
         * Conversion of an account ID to a contextual alias.
         */
        AccountToAlias: StorageDescriptor<[Key: SS58String], Anonymize<I6vki5ip88t309>, true, never>;
        /**
         * Association of an account ID to a personal ID.
         *
         * Managed with `set_personal_id_account` and `unset_personal_id_account`.
         * Reverse lookup is inside `People` storage, inside the record.
         */
        AccountToPersonalId: StorageDescriptor<[Key: SS58String], bigint, true, never>;
        /**
         * The next free and never reserved personal ID.
         */
        NextPersonalId: StorageDescriptor<[], bigint, false, never>;
        /**
         * Whether the people collection has been created.
         */
        PeopleCollectionCreated: StorageDescriptor<[], boolean, false, never>;
        /**
         * Candidates' reserved identities which we track.
         */
        ReservedPersonalId: StorageDescriptor<[Key: bigint], null, true, never>;
    };
    MobRule: {
        /**
         * The voting records of all aliases.
         */
        Credits: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I5h2gdbrcdulu5>, false, never>;
        /**
         * The vote penalties of users and their starting moment. Voters with penalties cannot vote in
         * contempt until the penalty expires and is removed.
         */
        VotingPenalties: StorageDescriptor<[Key: SizedHex<32>], number, true, never>;
        /**
         * The accumulated points of all aliases, during each funding round. The points accumulated
         * during round `N` can be redeemed for rewards only during round `N + 1`.
         */
        VotingPoints: StorageDescriptor<Anonymize<I4p5t2krb1gmvp>, number, false, never>;
        /**
         * All votes cast, segregated by case and voter.
         */
        Votes: StorageDescriptor<Anonymize<I4p5t2krb1gmvp>, Anonymize<Id32895epm7otq>, true, never>;
        /**
         * The number of cases, open or recently closed, stored in the pallet.
         */
        CaseCount: StorageDescriptor<[], number, false, never>;
        /**
         * The open cases recorded in the pallet. These cases can still be voted on.
         */
        OpenCases: StorageDescriptor<[Key: number], Anonymize<I14eopu9hl6hgk>, true, never>;
        /**
         * The ripe cases recorded in the pallet. The voting has concluded on these cases and a verdict
         * has been reached, but they cannot be removed yet in order to allow people to claim their
         * votes.
         */
        RipeCases: StorageDescriptor<[Key: number], Anonymize<Iaq1a4h34blh5u>, true, never>;
        /**
         * The done cases recorded in the pallet. These cases are obsolete and can be removed from
         * storage.
         */
        DoneCases: StorageDescriptor<[Key: number], Anonymize<Ieaqfchj8o5p3e>, true, never>;
        /**
         * The number of points accumulated through correct votes during the current payout round. This
         * amount is going to determine the point/reward exchange rate of the next reward payout round.
         */
        AccumulatedPoints: StorageDescriptor<[], bigint, false, never>;
        /**
         * Describes the parameters of the current payout round.
         */
        PayoutDistribution: StorageDescriptor<[], Anonymize<Ia11lg4mrmjqfg>, true, never>;
        /**
         * Describes the schedules of the payout rounds.
         */
        RoundSchedules: StorageDescriptor<[], Anonymize<Idevgv5mu1k9gt>, false, never>;
        /**
         * The timestamp, in seconds, of the moment enough active voters were detected and voting was
         * enabled. This value will not be present if there are too few active voters.
         */
        ActiveSince: StorageDescriptor<[], bigint, true, never>;
    };
    ProofOfInk: {
        /**
         * The current personal identities which are going through the proof-of-ink process.
         */
        Candidates: StorageDescriptor<[Key: SS58String], Anonymize<Ic5ardbudan54b>, true, never>;
        /**
         * The personal identities which we track; all which have been recognized through proof-of-ink
         * are in here.
         */
        People: StorageDescriptor<[Key: bigint], Anonymize<I6n9krukma1mut>, true, never>;
        /**
         * The tickets stored on-chain ready to be used to refer candidates.
         */
        ReferralTickets: StorageDescriptor<[Key: bigint], Anonymize<Ia2lhg7l2hilo3>, true, never>;
        /**
         * The current design families we recognise.
         */
        DesignFamilies: StorageDescriptor<[Key: number], Anonymize<Ie6cl0ap8d265e>, true, never>;
        /**
         * The committed designs which are no longer available.
         */
        CommittedDesigns: StorageDescriptor<Anonymize<I9jd27rnpm8ttv>, Anonymize<I9feps983hs1sf>, true, never>;
        /**
         * The number of judgements currently ongoing.
         */
        AllocationCount: StorageDescriptor<[], number, false, never>;
        /**
         * The configuration.
         */
        Configuration: StorageDescriptor<[], Anonymize<I63ubv9qb76gl3>, false, never>;
        /**
         * Number of invitations available to distribute for an account.
         */
        AvailableInvites: StorageDescriptor<[Key: SS58String], number, false, never>;
        /**
         * Pending invitations for each inviter (an account that invites others).
         *
         * If the key `(inviter, ticket)` exists, then the ticket is currently a pending invite.
         */
        PendingInvites: StorageDescriptor<Anonymize<I2na29tt2afp0j>, null, true, never>;
        /**
         * The values of the reimbursement awarded to referrers, along with how many of each value
         * should be awarded. These values are stored in reverse order of their priority, so the last
         * value in the list will be the first one to be used by the reimbursement system.
         *
         * Storage item name keeps the legacy prefix for storage readability compatibility.
         */
        ReferrerReimbursementValues: StorageDescriptor<[], Anonymize<Ifip05kcrl65am>, true, never>;
        /**
         * The values of the reimbursement awarded to referred people, along with how many of each
         * value should be awarded. These values are stored in reverse order of their priority, so the
         * last value in the list will be the first one to be used by the reimbursement system.
         *
         * Storage item name keeps the legacy prefix for storage readability compatibility.
         */
        ReferredReimbursementValues: StorageDescriptor<[], Anonymize<Ifip05kcrl65am>, true, never>;
    };
    Game: {
        /**
         * Phase-duration override set by [`Config::ManagerOrigin`] via
         * `set_game_phases`. `None` means the chain falls back to
         * `T::DefaultPhaseDurations`.
         */
        StoredPhaseDurations: StorageDescriptor<[], Anonymize<I1mvbp74tfuinr>, true, never>;
        /**
         * The configured native balance held as deposit when an account player signs up.
         *
         * This value is only used for new deposit creations; existing active deposits
         * retain the amount they were created with.
         */
        PlayDepositAmount: StorageDescriptor<[], bigint, false, never>;
        /**
         * All minted NFTs, keyed by owner and NFT hash. The value is a Unix-seconds
         * timestamp set whenever the entry is written: by the `report` extrinsic for a
         * fresh `Person` vote, by `mint_attendance_nfts` when an attendee's attendance
         * is finalised, or by `promote_nft_candidates` when a held `NotPerson` NFT is
         * resolved. Backfill writes overwrite an earlier timestamp on the same key —
         * the value is therefore the *most recent* mint time, not the first. Within a
         * single game these timestamps are bounded together (typically the same block),
         * so clients can use them as a per-game version marker (e.g. mapping old mints
         * to one image collection and newer mints to another).
         */
        Nfts: StorageDescriptor<Anonymize<I9u9nqhm3kqr8q>, number, true, never>;
        /**
         * Candidate NFTs staged from `NotPerson` reports, held until the attestee's
         * attendance is decided.
         *
         * During the reporting phase a `NotPerson` vote stages the NFT here rather than
         * minting directly into [`Nfts`]: the attestee only earns the NFT if they end up
         * classed as having attended. The first key is the prospective owner (the
         * attestee), the second is the NFT hash (same derivation as in [`Nfts`]).
         * Resolved entries are either promoted into [`Nfts`] or discarded — see
         * `promote_nft_candidates` / `discard_nft_candidates`.
         */
        NftCandidates: StorageDescriptor<Anonymize<I9u9nqhm3kqr8q>, null, true, never>;
        /**
         * All the player with zero score but still onboarded in indiv_pallet_score.
         */
        ArchivedPlayers: StorageDescriptor<[Key: Anonymize<Iavh3dqjok18o8>], Anonymize<I191vhdj2skphj>, true, never>;
        /**
         * All the player in the game.
         *
         * Account-based player accounts in this storage and statement accounts in
         * [`StmtAccountToAlias`] must not overlap.
         */
        Players: StorageDescriptor<[Key: Anonymize<Iavh3dqjok18o8>], Anonymize<Idm8j2k0kcll3q>, true, never>;
        /**
         * The current game index.
         */
        GameIndex: StorageDescriptor<[], number, false, never>;
        /**
         * The information for the next game or ongoing game.
         */
        Game: StorageDescriptor<[], Anonymize<I5uteah8rq8etm>, true, never>;
        /**
         * The mapping from past games, identified by their game index, to the start timestamp, in
         * seconds since the UNIX epoch.
         */
        GameHistory: StorageDescriptor<[Key: number], number, true, never>;
        /**
         * Entries of previously attended games of each player. Retained on `offboard`
         * and `kickout`. Bounded by `MaxAttendanceHistoryDepth` per player.
         */
        PlayerAttendanceHistory: StorageDescriptor<[Key: Anonymize<Iavh3dqjok18o8>], Anonymize<Icgljjb6j82uhn>, false, never>;
        /**
         * Count of confirmed attendees per game index. Incremented by
         * [`Pallet::note_attendance`] for every attendance entry, regardless of
         * whether the player is recorded as `AccountOrPerson::Person` or
         * `AccountOrPerson::Account`. Exposed for off-chain consumers.
         */
        GameParticipantCount: StorageDescriptor<[Key: number], number, false, never>;
        /**
         * The mapping from round index and player index to player.
         */
        IndexToPlayer: StorageDescriptor<[Key: Anonymize<I5g2vv0ckl2m8b>], Anonymize<Iavh3dqjok18o8>, true, never>;
        /**
         * The mapping from player to their indices in each round.
         */
        PlayerToIndex: StorageDescriptor<[Key: Anonymize<Iavh3dqjok18o8>], Anonymize<Icgljjb6j82uhn>, true, never>;
        /**
         * Storage used to compute the shuffle order of recognized people.
         */
        ShuffleRecognized: StorageDescriptor<Anonymize<I4p5t2krb1gmvp>, Anonymize<Iavh3dqjok18o8>, true, never>;
        /**
         * Storage used to compute the shuffle order of not recognized people, i.e. candidates.
         */
        ShuffleNotRecognized: StorageDescriptor<Anonymize<I4p5t2krb1gmvp>, Anonymize<Iavh3dqjok18o8>, true, never>;
        /**
        
         */
        GameSchedules: StorageDescriptor<[], Anonymize<I9sbfhir4aitej>, false, never>;
        /**
         * Number of invites available to distribute for an account.
         */
        AvailableInvites: StorageDescriptor<[Key: SS58String], number, false, never>;
        /**
         * Pending invites for each inviter.
         *
         * If the key `(inviter, ticket)` exists then the ticket is currently a pending invite, from
         * the inviter.
         */
        PendingInvites: StorageDescriptor<Anonymize<I2na29tt2afp0j>, null, true, never>;
        /**
         * Mapping from alias to the account id to use for interacting with the statement store.
         *
         * Account-based player simply use their account and are not part of this mapping.
         * Reverse mapping is available in storage [`StmtAccountToAlias`].
         *
         * This is removed when the alias-based player gets archived.
         * This is updated when the alias-based player signs up with another statement account.
         */
        AliasToStmtAccount: StorageDescriptor<[Key: SizedHex<32>], SS58String, true, never>;
        /**
         * Mapping from the account id to use for interacting with statement store to the alias.
         *
         * Account-based player simply use their account and are not part of this mapping.
         * Reverse mapping is available in storage [`AliasToStmtAccount`].
         * This is removed when the alias-based player gets archived.
         * This is updated when the alias-based player signs up with another statement account.
         *
         * Statement accounts in this storage and account-based player accounts in [`Players`] must
         * not overlap.
         */
        StmtAccountToAlias: StorageDescriptor<[Key: SS58String], SizedHex<32>, true, never>;
        /**
         * The communication identifiers used by players to establish an encrypted P2P connection in
         * order to play the game. The account under which the communication identifier is registered
         * should be the same account used to interact with the statement store.
         */
        CommunicationIdentifiers: StorageDescriptor<[Key: SS58String], SizedHex<65>, true, never>;
    };
    Score: {
        /**
         * The participants informations.
         */
        Participants: StorageDescriptor<[Key: Anonymize<Iavh3dqjok18o8>], Anonymize<I5rab7drti2f9h>, true, never>;
        /**
         * The score threshold required to reach personhood.
         */
        PersonhoodThreshold: StorageDescriptor<[], number, false, never>;
        /**
         * Runtime-configurable schedule of personhood-threshold tiers, sorted by
         * ascending `population_size_threshold`. Each tier specifies the score a
         * participant must reach to be recognized as a person at that population
         * level.
         *
         * Defaults to [`DefaultPersonhoodThresholdTiers`] until governance
         * overrides it via [`Pallet::set_personhood_threshold_schedule`].
         *
         * A new schedule takes effect at the start of the next report session
         * when `update_thresholds()` recalculates `PersonhoodThreshold`.
         */
        PersonhoodThresholdSchedule: StorageDescriptor<[], Anonymize<I26np7pq4hc9kt>, false, never>;
        /**
         * Runtime-configurable schedule of absence-grace tiers, sorted by ascending
         * population size threshold. Each tier specifies how many misses are
         * tolerated within recent games before a participant's personhood is
         * suspended.
         *
         * Defaults to [`DefaultAbsenceGraceTiers`] until governance overrides it
         * via [`Pallet::set_absence_grace_schedule`]. An empty schedule (set
         * explicitly by governance) disables the grace period entirely.
         */
        AbsenceGraceSchedule: StorageDescriptor<[], Anonymize<Idrbto15rld189>, false, never>;
        /**
         * The currently active absence-grace ratio `(allowed_misses, window)`,
         * derived from `AbsenceGraceSchedule` and the current active-person count.
         *
         * Updated each time `update_thresholds()` runs (at the start of every
         * attendance report session). Read by `set_attendance` to decide whether
         * a participant should be suspended.
         */
        AbsenceGraceRatio: StorageDescriptor<[], SizedHex<2>, false, never>;
        /**
         * The accumulated points in the current round.
         */
        CurrentRoundPoints: StorageDescriptor<[], number, false, never>;
        /**
         * The index of the current round.
         *
         * This must be the sum of all points accumulated in `RoundsPointsForParticipant` for the
         * current round.
         *
         * **WARNING**: This storage must be consistent with `RoundsPointsForParticipant`, use
         * `fn add_points_to_participant` to update it.
         */
        CurrentRoundIndex: StorageDescriptor<[], number, false, never>;
        /**
         * The points accumulated by a participant in a round.
         *
         * For the current round, this storage must be updated alongside `CurrentRoundPoints`.
         *
         * **WARNING**: This storage must be consistent with `CurrentRoundPoints`, use
         * `fn add_points_to_participant` to update it.
         */
        RoundsPointsForParticipant: StorageDescriptor<Anonymize<I6lggg4mrl1u2s>, number, false, never>;
        /**
         * The rounds that are currently paying out.
         *
         * Rounds are paying out after they have finished accumulating points.
         * When all their points have been paid out, they are removed from storage.
         */
        RoundPayouts: StorageDescriptor<[Key: number], Anonymize<I3nqube2n1nohj>, true, never>;
        /**
         * The planning of the current round that is accumulating points.
         *
         * If none the current round is ongoing and will be planned on the next schedule.
         */
        RoundPlanning: StorageDescriptor<[], Anonymize<Idodgrto60av5h>, true, never>;
        /**
         * Describes the schedules of the payout rounds.
         */
        RoundSchedules: StorageDescriptor<[], Anonymize<Id26d02t80vjh>, false, never>;
    };
    DummyDim: {
        /**
         * The personal IDs that are reserved by unproven people.
         */
        ReservedIds: StorageDescriptor<[Key: bigint], null, true, never>;
        /**
         * The people we track along with their records.
         */
        People: StorageDescriptor<[Key: bigint], Anonymize<I4009rejbekrdq>, true, never>;
    };
    PeopleLite: {
        /**
        
         */
        LitePeople: StorageDescriptor<[Key: SS58String], Anonymize<I81vbsdqasdsr1>, true, never>;
        /**
         * Conversion of a lite contextual alias to an account ID.
         */
        AliasToAccount: StorageDescriptor<[Key: Anonymize<Icq9999ubti4jr>], SS58String, true, never>;
        /**
         * Conversion of an account ID to a lite contextual alias.
         */
        AccountToAlias: StorageDescriptor<[Key: SS58String], Anonymize<I6vki5ip88t309>, true, never>;
        /**
         * Whether the lite people member collection has been created.
         */
        LitePeopleCollectionCreated: StorageDescriptor<[], boolean, false, never>;
        /**
         * Number of attestations available to distribute for a verifier account id.
         */
        AttestationAllowance: StorageDescriptor<[Key: SS58String], number, false, never>;
    };
    Resources: {
        /**
         * Accounts used to identify consumers mapped to their consumer information.
         */
        Consumers: StorageDescriptor<[Key: SS58String], Anonymize<I23bplm6qtgrpd>, true, never>;
        /**
         * Accounts associated with a statement store slot through an anonymous allowance, per period.
         *
         * The period key is a big-endian encoded day number (seconds since Unix epoch / 86400) so
         * that `Identity`-hashed iteration yields entries in chronological order to be removed by the
         * offchain worker.
         */
        StatementStoreAllowances: StorageDescriptor<Anonymize<I9jea06984vfti>, Anonymize<Ifopum5rctcidn>, true, never>;
        /**
         * Reverse lookup from a statement account to all its active anonymous allowances.
         *
         * Keyed by `(AccountId, (BigEndianU32 period, u32 seq, Alias))` → `()`. Multiple
         * entries per account are possible when the same statement account is authorized by
         * different aliases or across grace-window overlaps.
         */
        StmtStoreAllowanceByAccount: StorageDescriptor<Anonymize<I8vqqii9cbfqng>, null, true, never>;
        /**
         * Friend request registration by anonymous alias in friend request context.
         */
        FriendRequestRegistrationByAlias: StorageDescriptor<[Key: SizedHex<32>], Anonymize<Id77vvrgqmru2o>, true, never>;
        /**
         * Reverse lookup from friend request statement account to anonymous alias.
         */
        FriendRequestAliasByAccount: StorageDescriptor<[Key: SS58String], SizedHex<32>, true, never>;
        /**
         * Aliases that have already been used to claim long-term storage in a given period.
         *
         * Keyed by `(period, alias)`. Each counter value in the proof context produces a unique
         * alias, so a person can have up to `LongTermStorageClaimsPerPeriod` entries per period.
         * Old periods can be cleaned up via `clear_expired_long_term_storage_aliases`.
         *
         * The period key is `BigEndianU32` with `Identity` so iteration yields entries in
         * chronological order, matching `StatementStoreAllowances`.
         */
        SpentLongTermStorageAliases: StorageDescriptor<Anonymize<I9jea06984vfti>, null, true, never>;
        /**
         * Reverse lookup from `username` to the `AccountId` that has registered it. The `owner` value
         * should be a key in the `Consumers` map. There can be at most 2 usernames pointing to the
         * same `owner`:
         * - username associated with a consumer's lite person identity - this will always be present;
         * - optionally another username associated with the consumer's full person identity, if
         * applicable.
         */
        UsernameOwnerOf: StorageDescriptor<[Key: Uint8Array], SS58String, true, never>;
        /**
         * Reverse lookup from registered aliases to the `AccountId` used to register as a consumer.
         */
        AccountOfAlias: StorageDescriptor<[Key: SizedHex<32>], SS58String, true, never>;
        /**
         * The amount of time for which a username reservation is valid, in seconds. After this
         * time period elapses, the reservation can be voided.
         */
        UsernameReservationDuration: StorageDescriptor<[], bigint, false, never>;
        /**
         * Map from a reserved `username` to a queue of `ReservationQueueEntry` items, each holding an
         * account and the timestamp when it joined. Old reservations can be removed from storage.
         */
        UsernameReservationQueue: StorageDescriptor<[Key: Uint8Array], Anonymize<Ic66kva37scc9l>, true, never>;
        /**
         * Reverse lookup from an account to the username it has reserved. Each account can have at
         * most one active reservation at a time.
         */
        ReservationOf: StorageDescriptor<[Key: SS58String], Uint8Array, true, never>;
    };
    ChunksManager: {
        /**
         * Paginated collection of chunks (RingExponent -> PageIndex -> Chunks).
         */
        Chunks: StorageDescriptor<Anonymize<I7hvvp2oeegqa0>, Anonymize<I1fa62uavcqia6>, true, never>;
        /**
         * The hash for each page of chunks.
         */
        ChunkPageHashes: StorageDescriptor<Anonymize<I7hvvp2oeegqa0>, SizedHex<32>, true, never>;
    };
    Members: {
        /**
         * Information about each collection, keyed by identifier.
         */
        Collections: StorageDescriptor<[Key: SizedHex<32>], Anonymize<Ie3d56aup8po4r>, true, never>;
        /**
         * Collections that have been marked for deletion and are being processed.
         * Once a collection is moved here, normal operations will fail with CollectionNotFound.
         */
        SuspendedCollections: StorageDescriptor<[Key: SizedHex<32>], Anonymize<Ie3d56aup8po4r>, true, never>;
        /**
         * The identifiers of collections owned by an entity.
         */
        IdentifiersOf: StorageDescriptor<[Key: Anonymize<I9lcj3313n9e9v>], Anonymize<Ic5m5lp1oioo8r>, true, never>;
        /**
         * The current members we recognise.
         */
        Root: StorageDescriptor<Anonymize<I4pact7n2e9a0i>, Anonymize<I3136o2hmi4al3>, true, never>;
        /**
         * Old ring roots are retained for a grace period so that proofs generated against
         * previous revisions remain valid. Each root in the map is identified by the composite key
         * `(collection, ring index, ring revision)`. Entries can be cleaned up after
         * `OldRootRetentionDuration` has passed since the `archived_at` timestamp.
         *
         * This storage can contain some roots for deleted collections or removed rings.
         * The call `verify_membership_at_rev` and other operation using old roots must check the
         * existence of the collection and the root in order to not validate against dust.
         * The old roots will be removed after the retention duration.
         */
        OldRoots: StorageDescriptor<Anonymize<Iara29l6qkt9is>, Anonymize<Iff5ulsdvgntip>, true, never>;
        /**
         * Keeps track of the ring index currently being populated.
         */
        CurrentRingIndex: StorageDescriptor<[Key: SizedHex<32>], number, false, never>;
        /**
         * Maximum number of members queued before onboarding to a ring.
         */
        OnboardingSize: StorageDescriptor<[Key: SizedHex<32>], number, false, never>;
        /**
         * Both the keys that are included in built rings and the keys that will be used in future
         * rings. Paginated by (Identifier, RingIndex, PageIndex) where each page contains up to
         * `RingCapacityFromExponent` keys. The page size equals the flexible ring exponent's capacity,
         * ensuring Flexible collections never need more than one page.
         */
        RingKeys: StorageDescriptor<Anonymize<I2t447bb26t9i6>, Anonymize<Ic5m5lp1oioo8r>, false, never>;
        /**
         * Stores the meta information for each ring, the number of keys and how many are actually
         * included in the root.
         */
        RingKeysStatus: StorageDescriptor<Anonymize<I4pact7n2e9a0i>, Anonymize<I831tj5voub6u0>, false, never>;
        /**
         * A map of all rings which currently have pending suspensions and need cleaning, along with
         * their respective number of suspended keys which need to be removed.
         * Note: Currently only supports single-page rings, so bounded by `RingCapacityFromExponent`.
         */
        PendingSuspensions: StorageDescriptor<Anonymize<I4pact7n2e9a0i>, Anonymize<Icgljjb6j82uhn>, false, never>;
        /**
         * The number of members currently included in a ring.
         */
        ActiveMembers: StorageDescriptor<[Key: SizedHex<32>], number, false, never>;
        /**
         * The current members in each collection (either included in rings, suspended and queued
         * for removal from a ring, suspended and not in any ring, or onboarding).
         *
         * Collection identifier to member public key to the member's status.
         *
         * A key can belong to multiple collections.
         */
        Members: StorageDescriptor<Anonymize<I2ccsdtloqt0h4>, Anonymize<I54g1hqjgru9ba>, true, never>;
        /**
         * The current state of all rings managed for a given identifier.
         */
        RingsState: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I766emmc9ccni0>, false, never>;
        /**
         * Set of rings which are stale and require building.
         */
        StaleRings: StorageDescriptor<Anonymize<I4pact7n2e9a0i>, null, true, never>;
        /**
         * Keeps track of the page indices of the head and tail of the onboarding queue.
         */
        QueuePageIndices: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I9jd27rnpm8ttv>, false, never>;
        /**
         * Paginated collection of member public keys ready to be included in a ring.
         */
        OnboardingQueue: StorageDescriptor<Anonymize<I4pact7n2e9a0i>, Anonymize<Ic5m5lp1oioo8r>, false, never>;
        /**
         * Queue of ring pages pending deletion.
         *
         * This is used both by `remove_ring` (individual ring deletion) and by
         * collection deletion. Ring pages are processed from this queue via OCW
         * regardless of which operation queued them.
         */
        RingDeletionQueue: StorageDescriptor<Anonymize<I2t447bb26t9i6>, null, true, never>;
    };
    Coinage: {
        /**
         * Coins by owner.
         *
         * This storage map contains all the coins currently circulating. The coin is minted when
         * unloaded from the recycler, and destroyed when loaded into the recycler.
         */
        CoinsByOwner: StorageDescriptor<[Key: SS58String], Anonymize<I6sjgjftjavcbd>, true, never>;
        /**
         * Temporary lock expiry for coins that previously failed dispatch.
         *
         * A coin owner entry is locked until the stored Unix timestamp, preventing repeated failed
         * dispatch attempts in a short period.
         */
        LockedCoins: StorageDescriptor<[Key: SS58String], Anonymize<I2l7r05e3266s4>, true, never>;
        /**
         * The total value of coins that were burnt.
         *
         * This tracks value that is intentionally destroyed as part of protocol flows (for example:
         * recycler expiration cleanup and output-token spam penalty path). This storage item keeps
         * track of the total value of such destroyed coins.
         */
        TotalValueOfDestroyedCoins: StorageDescriptor<[], bigint, false, never>;
        /**
         * Consumed free unload tokens by period and alias.
         *
         * This storage keeps track of the free unload tokens that have been consumed by people
         * and lite people, to avoid double spending.
         *
         * It is cleared periodically.
         */
        ConsumedFreeUnloadTokens: StorageDescriptor<Anonymize<I4p5t2krb1gmvp>, null, true, never>;
        /**
         * Tracks whether a recycler collection exists for a given coin value.
         *
         * Recycler collections are normally created eagerly during one-time `on_poll`
         * initialization after `UnderlyingAssetId` has been set.
         * [`RecyclerManager::ensure_collection_exists`] remains the fallback for
         * first-use or recovery paths when a collection is still missing.
         *
         * **WARNING**: Do not use this storage directly, use [`RecyclerManager`] type instead.
         *
         * This storage item is managed by [`RecyclerManager`] and is part of a consistent set:
         * * [RecyclerCollectionCreated] - whether the collection exists for a coin value.
         * * [RecyclersLastRemovedRingIndex] - the last removed ring index for each coin value.
         * * [RecyclersCoinToRecycler] - the mapping from member key to the coin value it is in.
         * * [RecyclersUnloaded] - the recyclers' unloaded aliases, indexed by coin value and ring
         * index.
         * * [RecyclersDusting] - marks rings with unloaded aliases pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        RecyclerCollectionCreated: StorageDescriptor<[Key: number], null, true, never>;
        /**
         * Last removed ring index per recycler coin value.
         *
         * Rings are removed sequentially starting from index 0. The next ring to check for
         * expiration is `last_removed + 1` (or `0` if nothing has been removed yet).
         *
         * **WARNING**: Do not use this storage directly, use [`RecyclerManager`] type instead.
         *
         * This storage item is managed by [`RecyclerManager`] and is part of a consistent set:
         * * [RecyclerCollectionCreated] - whether the collection exists for a coin value.
         * * [RecyclersLastRemovedRingIndex] - the last removed ring index for each coin value.
         * * [RecyclersCoinToRecycler] - the mapping from member key to the coin value it is in.
         * * [RecyclersUnloaded] - the recyclers' unloaded aliases, indexed by coin value and ring
         * index.
         * * [RecyclersDusting] - marks rings with unloaded aliases pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        RecyclersLastRemovedRingIndex: StorageDescriptor<[Key: number], number, true, never>;
        /**
         * Mapping from a recycler member key to the coin value it belongs to.
         *
         * When a coin is loaded into a recycler, the member key is recorded here so that the
         * pallet can look up which coin value the member key corresponds to.
         *
         * **WARNING**: Do not use this storage directly, use [`RecyclerManager`] type instead.
         *
         * This storage item is managed by [`RecyclerManager`] and is part of a consistent set:
         * * [RecyclerCollectionCreated] - whether the collection exists for a coin value.
         * * [RecyclersLastRemovedRingIndex] - the last removed ring index for each coin value.
         * * [RecyclersCoinToRecycler] - the mapping from member key to the coin value it is in.
         * * [RecyclersUnloaded] - the recyclers' unloaded aliases, indexed by coin value and ring
         * index.
         * * [RecyclersDusting] - marks rings with unloaded aliases pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        RecyclersCoinToRecycler: StorageDescriptor<[Key: SizedHex<32>], number, true, never>;
        /**
         * The recyclers' unloaded aliases, indexed by (coin value, ring index, alias).
         *
         * When a coin is unloaded from a recycler, the alias produced by the ring-VRF proof is
         * stored here to prevent double-spending within the same recycler ring.
         *
         * **WARNING**: Do not use this storage directly, use [`RecyclerManager`] type instead.
         *
         * This storage item is managed by [`RecyclerManager`] and is part of a consistent set:
         * * [RecyclerCollectionCreated] - whether the collection exists for a coin value.
         * * [RecyclersLastRemovedRingIndex] - the last removed ring index for each coin value.
         * * [RecyclersCoinToRecycler] - the mapping from member key to the coin value it is in.
         * * [RecyclersUnloaded] - the recyclers' unloaded aliases, indexed by coin value and ring
         * index.
         * * [RecyclersDusting] - marks rings with unloaded aliases pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        RecyclersUnloaded: StorageDescriptor<Anonymize<I5eoome1iv99mc>, null, true, never>;
        /**
         * Marks recycler rings that have unloaded aliases pending removal.
         *
         * When a recycler ring is removed, the cleanup of its unloaded aliases in
         * [RecyclersUnloaded] is performed gradually through this storage item. An entry here
         * indicates that unloaded aliases for the given coin value and ring index still exist
         * and should be dusted.
         *
         * **WARNING**: Do not use this storage directly, use [`RecyclerManager`] type instead.
         *
         * This storage item is managed by [`RecyclerManager`] and is part of a consistent set:
         * * [RecyclerCollectionCreated] - whether the collection exists for a coin value.
         * * [RecyclersLastRemovedRingIndex] - the last removed ring index for each coin value.
         * * [RecyclersCoinToRecycler] - the mapping from member key to the coin value it is in.
         * * [RecyclersUnloaded] - the recyclers' unloaded aliases, indexed by coin value and ring
         * index.
         * * [RecyclersDusting] - marks rings with unloaded aliases pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        RecyclersDusting: StorageDescriptor<[Key: Anonymize<I5g2vv0ckl2m8b>], null, true, never>;
        /**
         * Mapping from a paid token member key to the period it belongs to.
         *
         * When a user pays for a recycler unload token, the member key is recorded here so
         * that the pallet can look up which period the member key corresponds to.
         *
         * **WARNING**: Do not use this storage directly, use [`PaidTknManager`] type instead.
         *
         * This storage item is managed by [`PaidTknManager`] and is part of a consistent set:
         * * [PaidUnloadTokenMembers] - tracks registered member keys.
         * * [PaidUnloadTokenConsumed] - the consumed paid unload token aliases.
         * * [PaidTokenCollectionsCreated] - whether the collection exists for a period.
         * * [PaidUnloadTokenDusting] - marks periods with consumed tokens pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        PaidUnloadTokenMembers: StorageDescriptor<[Key: SizedHex<32>], null, true, never>;
        /**
         * Consumed paid unload tokens by period, ring index and alias.
         *
         * When a paid unload token is consumed, the alias produced by the ring-VRF proof is
         * stored here to prevent double-spending within the same ring.
         *
         * **WARNING**: Do not use this storage directly, use [`PaidTknManager`] type instead.
         *
         * This storage item is managed by [`PaidTknManager`] and is part of a consistent set:
         * * [PaidUnloadTokenMembers] - tracks registered member keys.
         * * [PaidUnloadTokenConsumed] - the consumed paid unload token aliases.
         * * [PaidTokenCollectionsCreated] - whether the collection exists for a period.
         * * [PaidUnloadTokenDusting] - marks periods with consumed tokens pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        PaidUnloadTokenConsumed: StorageDescriptor<Anonymize<Ib55cg44k2chb5>, null, true, never>;
        /**
         * Tracks whether a paid token collection exists for a given period.
         *
         * Uses `Identity` hasher so that iteration yields periods in order, enabling efficient
         * cleanup of expired periods.
         *
         * **WARNING**: Do not use this storage directly, use [`PaidTknManager`] type instead.
         *
         * This storage item is managed by [`PaidTknManager`] and is part of a consistent set:
         * * [PaidUnloadTokenMembers] - tracks registered member keys.
         * * [PaidUnloadTokenConsumed] - the consumed paid unload token aliases.
         * * [PaidTokenCollectionsCreated] - whether the collection exists for a period.
         * * [PaidUnloadTokenDusting] - marks periods with consumed tokens pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        PaidTokenCollectionsCreated: StorageDescriptor<[Key: SizedHex<4>], null, true, never>;
        /**
         * Marks paid unload token periods that have consumed tokens pending removal.
         *
         * When a paid unload token collection is removed, the cleanup of its consumed tokens in
         * [PaidUnloadTokenConsumed] is performed gradually through this storage item. An entry
         * here indicates that consumed tokens for the given period still exist and should be
         * dusted.
         *
         * **WARNING**: Do not use this storage directly, use [`PaidTknManager`] type instead.
         *
         * This storage item is managed by [`PaidTknManager`] and is part of a consistent set:
         * * [PaidUnloadTokenMembers] - tracks registered member keys.
         * * [PaidUnloadTokenConsumed] - the consumed paid unload token aliases.
         * * [PaidTokenCollectionsCreated] - whether the collection exists for a period.
         * * [PaidUnloadTokenDusting] - marks periods with consumed tokens pending removal.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        PaidUnloadTokenDusting: StorageDescriptor<[Key: SizedHex<4>], null, true, never>;
        /**
         * Tracks the next ring index to clean for each expired period.
         *
         * Used by the OCW to determine cleanup progress and by the collection deletion
         * extrinsic to verify all rings have been cleaned.
         *
         * Rings are cleaned sequentially (one per OCW interval) rather than all at once.
         * This is intentional: a single storage cursor enables O(1) completion checks in
         * both [`PaidTknManager::ensure_can_clean_ring`] and
         * [`PaidTknManager::ensure_can_delete_collection`]. The alternative — submitting
         * all ring cleans in parallel — would require fetching ring members to check whether
         * each ring was already cleaned (since `ring_status` still reports `total > 0` after
         * cleanup because rings are not removed until collection deletion). Cleanup of expired
         * collections is not time-critical, so the simpler sequential approach is preferred.
         *
         * **WARNING**: Do not use this storage directly, use [`PaidTknManager`] type instead.
         *
         * This storage item is managed by [`PaidTknManager`] and is part of a consistent set:
         * * [PaidUnloadTokenMembers] - tracks registered member keys.
         * * [PaidUnloadTokenConsumed] - the consumed paid unload token aliases.
         * * [PaidTokenCollectionsCreated] - whether the collection exists for a period.
         * * [PaidUnloadTokenDusting] - marks periods with consumed tokens pending removal.
         * * [PaidUnloadTokenNextRingToClean] - sequential ring cleanup progress.
         *
         * Ring members, pending members, and ring state are managed by [`Config::MemberService`].
         */
        PaidUnloadTokenNextRingToClean: StorageDescriptor<[Key: SizedHex<4>], number, true, never>;
        /**
         * Whether the one-time pallet initialization has run.
         *
         * Set by [`Pallet::do_initialize`] once recycler collections are created and the pallet
         * account has been ensured to hold the minimum balance of [`UnderlyingAssetId`].
         * Initialization is gated on `UnderlyingAssetId` being set, so this stays unset until
         * governance has called [`Pallet::set_underlying_asset_id`].
         */
        InitializePalletAccount: StorageDescriptor<[], null, true, never>;
        /**
         * The underlying asset id for the coins.
         *
         * Set once by [`Config::UnderlyingAssetIdManager`] via
         * [`Pallet::set_underlying_asset_id`]. While unset, every coin/recycler operation that
         * needs the underlying asset fails with [`Error::AssetIdNotSet`] (or
         * [`CustomInvalidity::AssetIdNotSet`] in transaction extension validation).
         */
        UnderlyingAssetId: StorageDescriptor<[], Anonymize<If9iqq7i64mur8>, true, never>;
    };
    MembersNotifier: {
        /**
         * Subscriber registry with their subscribed collections and initialization state.
         */
        Subscribers: StorageDescriptor<[Key: number], Anonymize<I6msd8eb5ee1ee>, true, never>;
        /**
         * Counter for the related counted storage map
         */
        CounterForSubscribers: StorageDescriptor<[], number, false, never>;
        /**
         * Sequence number for sealed batch.
         * Incremented when a batch is sealed - ready for distribution.
         * Serves as the batch identifier for replay and distribution.
         */
        SealedBatchSequence: StorageDescriptor<[], bigint, false, never>;
        /**
         * Paging state: write page, send page, and last update block.
         */
        PageState: StorageDescriptor<[], Anonymize<I5b6v7o79lps5k>, false, never>;
        /**
         * Changed ring root keys, paged.
         * Key: (page_index, identifier, ring_index). Populated by `OnRingRootChange`,
         * consumed by `enqueue_updates` one page at a time from `PageState::send_page`.
         */
        PendingUpdates: StorageDescriptor<Anonymize<I4hus3s8lblmj7>, null, true, never>;
        /**
         * Per-page count of entries in PendingUpdates.
         */
        PageUpdatesCount: StorageDescriptor<[Key: number], number, false, never>;
        /**
         * State for paginated subscriber initialization.
         */
        PendingInit: StorageDescriptor<[Key: number], Anonymize<Iff773s2hdisds>, true, never>;
        /**
         * Counter for the related counted storage map
         */
        CounterForPendingInit: StorageDescriptor<[], number, false, never>;
        /**
         * Indices per collection for the sealed (current) batch.
         */
        SealedBatchIndices: StorageDescriptor<[Key: SizedHex<32>], Anonymize<Icgljjb6j82uhn>, true, never>;
        /**
         * Current batch distribution state.
         */
        CurrentBatch: StorageDescriptor<[], Anonymize<Ieenjgm8k62jr1>, true, never>;
        /**
         * Tracks which subscribers have received the current batch.
         */
        SubscribersWithCurrentBatch: StorageDescriptor<[Key: number], null, true, never>;
        /**
         * Last replay time per (subscriber, collection) pair.
         * Used to enforce a cooldown between replay requests.
         */
        LastReplayTime: StorageDescriptor<Anonymize<I4p5t2krb1gmvp>, bigint, true, never>;
    };
    Airdrop: {
        /**
         * Registered airdrop events, keyed by their identifier.
         */
        Events: StorageDescriptor<[Key: SizedHex<32>], Anonymize<I92h4q810prvth>, true, never>;
        /**
         * Pending lifecycle actions for registered events, ordered by the timestamp at which the
         * action should take place.
         */
        ActionSchedule: StorageDescriptor<Anonymize<Ieso6d402ilf6g>, null, true, never>;
        /**
         * Per-event participant registrations, keyed by 32-byte entropy slot
         * in big-endian order under `Identity`.
         */
        Registrations: StorageDescriptor<Anonymize<Id5m5ie1nmrke2>, Anonymize<I6cunlo5qsnfm5>, true, never>;
        /**
         * Winners for an event, keyed by the event identifier and their registration entry. This maps
         * to the participant's ticket for offchain lookup purposes.
         */
        Winners: StorageDescriptor<Anonymize<I58ai4tjcgea3g>, SizedHex<32>, true, never>;
        /**
         * Entropy seed captured at draw time, per event. This serves as a partition point in the
         * participation ticket ordered list in order to pick winners.
         */
        EventEntropy: StorageDescriptor<[Key: SizedHex<32>], SizedHex<32>, true, never>;
        /**
         * Per-asset enablement gate. An asset is usable for scheduling events iff it is present in
         * this map; the stored value is the amount the pallet transferred into its pot to keep the
         * pot's asset account alive (the asset's ED at the time of enabling). `enable_asset` /
         * `disable_asset` are the only ways to mutate this.
         */
        SupportedAssets: StorageDescriptor<[Key: Anonymize<If9iqq7i64mur8>], bigint, true, never>;
    };
    Honour: {
        /**
         * Points that have been used by voters.
         *
         * Records in [`Points`] track used points to prevent double-spending and enforce rate-limiting
         * based on the last usage time.
         */
        Points: StorageDescriptor<[Key: SizedHex<32>], Anonymize<Ibto3ou3o2r7sv>, true, never>;
        /**
         * Votes that have been bestowed.
         *
         * Prevents double-voting on the same subject by the same voter, as [`SubjectAlias`] is
         * uniquely derived from [`SubjectId`] for each voter.
         */
        Votes: StorageDescriptor<[Key: SizedHex<32>], null, true, never>;
        /**
         * Absolute honour score of a subject. Initialized to -1 to offset self-votes.
         */
        Tally: StorageDescriptor<[Key: SizedHex<32>], number, true, never>;
    };
    StorageInitialization: {
        /**
         * Current state of the initialization process in on_poll hook.
         */
        OnPollStatus: StorageDescriptor<[], Anonymize<I94nsao83dbuk9>, false, never>;
        /**
         * Block number when XCM transfer was initiated.
         * Used to track transfer timeout.
         */
        XcmTransferInitiatedAt: StorageDescriptor<[], number, true, never>;
    };
    MultiBlockMigrations: {
        /**
         * The currently active migration to run and its cursor.
         *
         * `None` indicates that no migration is running.
         */
        Cursor: StorageDescriptor<[], Anonymize<Iepbsvlk3qceij>, true, never>;
        /**
         * Set of all successfully executed migrations.
         *
         * This is used as blacklist, to not re-execute migrations that have not been removed from the
         * codebase yet. Governance can regularly clear this out via `clear_historic`.
         */
        Historic: StorageDescriptor<[Key: Uint8Array], null, true, never>;
    };
};
type ICalls = {
    System: {
        /**
         * Make some on-chain remark.
         *
         * Can be executed by every `origin`.
         */
        remark: TxDescriptor<Anonymize<I8ofcg5rbj0g2c>>;
        /**
         * Set the number of pages in the WebAssembly environment's heap.
         */
        set_heap_pages: TxDescriptor<Anonymize<I4adgbll7gku4i>>;
        /**
         * Set the new runtime code.
         */
        set_code: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
        /**
         * Set the new runtime code without doing any checks of the given `code`.
         *
         * Note that runtime upgrades will not run if this is called with a not-increasing spec
         * version!
         */
        set_code_without_checks: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
        /**
         * Set some items of storage.
         */
        set_storage: TxDescriptor<Anonymize<I9pj91mj79qekl>>;
        /**
         * Kill some items from storage.
         */
        kill_storage: TxDescriptor<Anonymize<I39uah9nss64h9>>;
        /**
         * Kill all storage items with a key that starts with the given prefix.
         *
         * **NOTE:** We rely on the Root origin to provide us the number of subkeys under
         * the prefix we are removing to accurately calculate the weight of this function.
         */
        kill_prefix: TxDescriptor<Anonymize<Ik64dknsq7k08>>;
        /**
         * Make some on-chain remark and emit event.
         */
        remark_with_event: TxDescriptor<Anonymize<I8ofcg5rbj0g2c>>;
        /**
         * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
         * later.
         *
         * This call requires Root origin.
         */
        authorize_upgrade: TxDescriptor<Anonymize<Ib51vk42m1po4n>>;
        /**
         * Authorize an upgrade to a given `code_hash` for the runtime. The runtime can be supplied
         * later.
         *
         * WARNING: This authorizes an upgrade that will take place without any safety checks, for
         * example that the spec name remains the same and that the version number increases. Not
         * recommended for normal use. Use `authorize_upgrade` instead.
         *
         * This call requires Root origin.
         */
        authorize_upgrade_without_checks: TxDescriptor<Anonymize<Ib51vk42m1po4n>>;
        /**
         * Provide the preimage (runtime binary) `code` for an upgrade that has been authorized.
         *
         * If the authorization required a version check, this call will ensure the spec name
         * remains unchanged and that the spec version has increased.
         *
         * Depending on the runtime's `OnSetCode` configuration, this function may directly apply
         * the new `code` in the same block or attempt to schedule the upgrade.
         *
         * All origins are allowed.
         */
        apply_authorized_upgrade: TxDescriptor<Anonymize<I6pjjpfvhvcfru>>;
    };
    ParachainSystem: {
        /**
         * Set the current validation data.
         *
         * This should be invoked exactly once per block. It will panic at the finalization
         * phase if the call was not invoked.
         *
         * The dispatch origin for this call must be `Inherent`
         *
         * As a side effect, this function upgrades the current validation function
         * if the appropriate time has come.
         */
        set_validation_data: TxDescriptor<Anonymize<Ial23jn8hp0aen>>;
        /**
        
         */
        sudo_send_upward_message: TxDescriptor<Anonymize<Ifpj261e8s63m3>>;
    };
    Timestamp: {
        /**
         * Set the current time.
         *
         * This call should be invoked exactly once per block. It will panic at the finalization
         * phase, if this call hasn't been invoked by that time.
         *
         * The timestamp should be greater than the previous one by the amount specified by
         * [`Config::MinimumPeriod`].
         *
         * The dispatch origin for this call must be _None_.
         *
         * This dispatch class is _Mandatory_ to ensure it gets executed in the block. Be aware
         * that changing the complexity of this call could result exhausting the resources in a
         * block to execute any other calls.
         *
         * ## Complexity
         * - `O(1)` (Note that implementations of `OnTimestampSet` must also be `O(1)`)
         * - 1 storage read and 1 storage mutation (codec `O(1)` because of `DidUpdate::take` in
         * `on_finalize`)
         * - 1 event handler `on_timestamp_set`. Must be `O(1)`.
         */
        set: TxDescriptor<Anonymize<Idcr6u6361oad9>>;
    };
    Balances: {
        /**
         * Transfer some liquid free balance to another account.
         *
         * `transfer_allow_death` will set the `FreeBalance` of the sender and receiver.
         * If the sender's account is below the existential deposit as a result
         * of the transfer, the account will be reaped.
         *
         * The dispatch origin for this call must be `Signed` by the transactor.
         */
        transfer_allow_death: TxDescriptor<Anonymize<I4ktuaksf5i1gk>>;
        /**
         * Exactly as `transfer_allow_death`, except the origin must be root and the source account
         * may be specified.
         */
        force_transfer: TxDescriptor<Anonymize<I9bqtpv2ii35mp>>;
        /**
         * Same as the [`transfer_allow_death`] call, but with a check that the transfer will not
         * kill the origin account.
         *
         * 99% of the time you want [`transfer_allow_death`] instead.
         *
         * [`transfer_allow_death`]: struct.Pallet.html#method.transfer
         */
        transfer_keep_alive: TxDescriptor<Anonymize<I4ktuaksf5i1gk>>;
        /**
         * Transfer the entire transferable balance from the caller account.
         *
         * NOTE: This function only attempts to transfer _transferable_ balances. This means that
         * any locked, reserved, or existential deposits (when `keep_alive` is `true`), will not be
         * transferred by this function. To ensure that this function results in a killed account,
         * you might need to prepare the account by removing any reference counters, storage
         * deposits, etc...
         *
         * The dispatch origin of this call must be Signed.
         *
         * - `dest`: The recipient of the transfer.
         * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
         * of the funds the account has, causing the sender account to be killed (false), or
         * transfer everything except at least the existential deposit, which will guarantee to
         * keep the sender account alive (true).
         */
        transfer_all: TxDescriptor<Anonymize<I9j7pagd6d4bda>>;
        /**
         * Unreserve some balance from a user by force.
         *
         * Can only be called by ROOT.
         */
        force_unreserve: TxDescriptor<Anonymize<I2h9pmio37r7fb>>;
        /**
         * Upgrade a specified account.
         *
         * - `origin`: Must be `Signed`.
         * - `who`: The account to be upgraded.
         *
         * This will waive the transaction fee if at least all but 10% of the accounts needed to
         * be upgraded. (We let some not have to be upgraded just in order to allow for the
         * possibility of churn).
         */
        upgrade_accounts: TxDescriptor<Anonymize<Ibmr18suc9ikh9>>;
        /**
         * Set the regular balance of a given account.
         *
         * The dispatch origin for this call is `root`.
         */
        force_set_balance: TxDescriptor<Anonymize<I9iq22t0burs89>>;
        /**
         * Adjust the total issuance in a saturating way.
         *
         * Can only be called by root and always needs a positive `delta`.
         *
         * # Example
         */
        force_adjust_total_issuance: TxDescriptor<Anonymize<I5u8olqbbvfnvf>>;
        /**
         * Burn the specified liquid free balance from the origin account.
         *
         * If the origin's account ends up below the existential deposit as a result
         * of the burn and `keep_alive` is false, the account will be reaped.
         *
         * Unlike sending funds to a _burn_ address, which merely makes the funds inaccessible,
         * this `burn` operation will reduce total issuance by the amount _burned_.
         */
        burn: TxDescriptor<Anonymize<I5utcetro501ir>>;
    };
    OriginRestriction: {
        /**
         * Allow to clean usage associated with an entity when it is zero or when there is no
         * longer any allowance for the origin.
         */
        clean_usage: TxDescriptor<Anonymize<Iea5hvin03frku>>;
    };
    Assets: {
        /**
         * Issue a new class of fungible assets from a public origin.
         *
         * This new asset class has no assets initially and its owner is the origin.
         *
         * The origin must conform to the configured `CreateOrigin` and have sufficient funds free.
         *
         * Funds of sender are reserved by `AssetDeposit`.
         *
         * Parameters:
         * - `id`: The identifier of the new asset. This must not be currently in use to identify
         * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
         * - `admin`: The admin of this class of assets. The admin is the initial address of each
         * member of the asset class's admin team.
         * - `min_balance`: The minimum balance of this new asset that any single account must
         * have. If an account's balance is reduced below this, then it collapses to zero.
         *
         * Emits `Created` event when successful.
         *
         * Weight: `O(1)`
         */
        create: TxDescriptor<Anonymize<I7t2thek61ghou>>;
        /**
         * Issue a new class of fungible assets from a privileged origin.
         *
         * This new asset class has no assets initially.
         *
         * The origin must conform to `ForceOrigin`.
         *
         * Unlike `create`, no funds are reserved.
         *
         * - `id`: The identifier of the new asset. This must not be currently in use to identify
         * an existing asset. If [`NextAssetId`] is set, then this must be equal to it.
         * - `owner`: The owner of this class of assets. The owner has full superuser permissions
         * over this asset, but may later change and configure the permissions using
         * `transfer_ownership` and `set_team`.
         * - `min_balance`: The minimum balance of this new asset that any single account must
         * have. If an account's balance is reduced below this, then it collapses to zero.
         *
         * Emits `ForceCreated` event when successful.
         *
         * Weight: `O(1)`
         */
        force_create: TxDescriptor<Anonymize<I61tdrsafr1vf3>>;
        /**
         * Start the process of destroying a fungible asset class.
         *
         * `start_destroy` is the first in a series of extrinsics that should be called, to allow
         * destruction of an asset class.
         *
         * The origin must conform to `ForceOrigin` or must be `Signed` by the asset's `owner`.
         *
         * - `id`: The identifier of the asset to be destroyed. This must identify an existing
         * asset.
         *
         * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
         * an account contains holds or freezes in place.
         */
        start_destroy: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Destroy all accounts associated with a given asset.
         *
         * `destroy_accounts` should only be called after `start_destroy` has been called, and the
         * asset is in a `Destroying` state.
         *
         * Due to weight restrictions, this function may need to be called multiple times to fully
         * destroy all accounts. It will destroy `RemoveItemsLimit` accounts at a time.
         *
         * - `id`: The identifier of the asset to be destroyed. This must identify an existing
         * asset.
         *
         * Each call emits the `Event::DestroyedAccounts` event.
         */
        destroy_accounts: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Destroy all approvals associated with a given asset up to the max (T::RemoveItemsLimit).
         *
         * `destroy_approvals` should only be called after `start_destroy` has been called, and the
         * asset is in a `Destroying` state.
         *
         * Due to weight restrictions, this function may need to be called multiple times to fully
         * destroy all approvals. It will destroy `RemoveItemsLimit` approvals at a time.
         *
         * - `id`: The identifier of the asset to be destroyed. This must identify an existing
         * asset.
         *
         * Each call emits the `Event::DestroyedApprovals` event.
         */
        destroy_approvals: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Complete destroying asset and unreserve currency.
         *
         * `finish_destroy` should only be called after `start_destroy` has been called, and the
         * asset is in a `Destroying` state. All accounts or approvals should be destroyed before
         * hand.
         *
         * - `id`: The identifier of the asset to be destroyed. This must identify an existing
         * asset.
         *
         * Each successful call emits the `Event::Destroyed` event.
         */
        finish_destroy: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Mint assets of a particular class.
         *
         * The origin must be Signed and the sender must be the Issuer of the asset `id`.
         *
         * - `id`: The identifier of the asset to have some amount minted.
         * - `beneficiary`: The account to be credited with the minted assets.
         * - `amount`: The amount of the asset to be minted.
         *
         * Emits `Issued` event when successful.
         *
         * Weight: `O(1)`
         * Modes: Pre-existing balance of `beneficiary`; Account pre-existence of `beneficiary`.
         */
        mint: TxDescriptor<Anonymize<Icfoe9q8d4vs8f>>;
        /**
         * Reduce the balance of `who` by as much as possible up to `amount` assets of `id`.
         *
         * Origin must be Signed and the sender should be the Manager of the asset `id`.
         *
         * Bails with `NoAccount` if the `who` is already dead.
         *
         * - `id`: The identifier of the asset to have some amount burned.
         * - `who`: The account to be debited from.
         * - `amount`: The maximum amount by which `who`'s balance should be reduced.
         *
         * Emits `Burned` with the actual amount burned. If this takes the balance to below the
         * minimum for the asset, then the amount burned is increased to take it to zero.
         *
         * Weight: `O(1)`
         * Modes: Post-existence of `who`; Pre & post Zombie-status of `who`.
         */
        burn: TxDescriptor<Anonymize<Ibrfmvjrg4trnb>>;
        /**
         * Move some assets from the sender account to another.
         *
         * Origin must be Signed.
         *
         * - `id`: The identifier of the asset to have some amount transferred.
         * - `target`: The account to be credited.
         * - `amount`: The amount by which the sender's balance of assets should be reduced and
         * `target`'s balance increased. The amount actually transferred may be slightly greater in
         * the case that the transfer would otherwise take the sender balance above zero but below
         * the minimum balance. Must be greater than zero.
         *
         * Emits `Transferred` with the actual amount transferred. If this takes the source balance
         * to below the minimum for the asset, then the amount transferred is increased to take it
         * to zero.
         *
         * Weight: `O(1)`
         * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
         * `target`.
         */
        transfer: TxDescriptor<Anonymize<Iedih7t34maii9>>;
        /**
         * Move some assets from the sender account to another, keeping the sender account alive.
         *
         * Origin must be Signed.
         *
         * - `id`: The identifier of the asset to have some amount transferred.
         * - `target`: The account to be credited.
         * - `amount`: The amount by which the sender's balance of assets should be reduced and
         * `target`'s balance increased. The amount actually transferred may be slightly greater in
         * the case that the transfer would otherwise take the sender balance above zero but below
         * the minimum balance. Must be greater than zero.
         *
         * Emits `Transferred` with the actual amount transferred. If this takes the source balance
         * to below the minimum for the asset, then the amount transferred is increased to take it
         * to zero.
         *
         * Weight: `O(1)`
         * Modes: Pre-existence of `target`; Post-existence of sender; Account pre-existence of
         * `target`.
         */
        transfer_keep_alive: TxDescriptor<Anonymize<Iedih7t34maii9>>;
        /**
         * Move some assets from one account to another.
         *
         * Origin must be Signed and the sender should be the Admin of the asset `id`.
         *
         * - `id`: The identifier of the asset to have some amount transferred.
         * - `source`: The account to be debited.
         * - `dest`: The account to be credited.
         * - `amount`: The amount by which the `source`'s balance of assets should be reduced and
         * `dest`'s balance increased. The amount actually transferred may be slightly greater in
         * the case that the transfer would otherwise take the `source` balance above zero but
         * below the minimum balance. Must be greater than zero.
         *
         * Emits `Transferred` with the actual amount transferred. If this takes the source balance
         * to below the minimum for the asset, then the amount transferred is increased to take it
         * to zero.
         *
         * Weight: `O(1)`
         * Modes: Pre-existence of `dest`; Post-existence of `source`; Account pre-existence of
         * `dest`.
         */
        force_transfer: TxDescriptor<Anonymize<I4e902qbfel1f1>>;
        /**
         * Disallow further unprivileged transfers of an asset `id` from an account `who`. `who`
         * must already exist as an entry in `Account`s of the asset. If you want to freeze an
         * account that does not have an entry, use `touch_other` first.
         *
         * Origin must be Signed and the sender should be the Freezer of the asset `id`.
         *
         * - `id`: The identifier of the asset to be frozen.
         * - `who`: The account to be frozen.
         *
         * Emits `Frozen`.
         *
         * Weight: `O(1)`
         */
        freeze: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
        /**
         * Allow unprivileged transfers to and from an account again.
         *
         * Origin must be Signed and the sender should be the Admin of the asset `id`.
         *
         * - `id`: The identifier of the asset to be frozen.
         * - `who`: The account to be unfrozen.
         *
         * Emits `Thawed`.
         *
         * Weight: `O(1)`
         */
        thaw: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
        /**
         * Disallow further unprivileged transfers for the asset class.
         *
         * Origin must be Signed and the sender should be the Freezer of the asset `id`.
         *
         * - `id`: The identifier of the asset to be frozen.
         *
         * Emits `Frozen`.
         *
         * Weight: `O(1)`
         */
        freeze_asset: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Allow unprivileged transfers for the asset again.
         *
         * Origin must be Signed and the sender should be the Admin of the asset `id`.
         *
         * - `id`: The identifier of the asset to be thawed.
         *
         * Emits `Thawed`.
         *
         * Weight: `O(1)`
         */
        thaw_asset: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Change the Owner of an asset.
         *
         * Origin must be Signed and the sender should be the Owner of the asset `id`.
         *
         * - `id`: The identifier of the asset.
         * - `owner`: The new Owner of this asset.
         *
         * Emits `OwnerChanged`.
         *
         * Weight: `O(1)`
         */
        transfer_ownership: TxDescriptor<Anonymize<I1t8vq6a06ohhu>>;
        /**
         * Change the Issuer, Admin and Freezer of an asset.
         *
         * Origin must be Signed and the sender should be the Owner of the asset `id`.
         *
         * - `id`: The identifier of the asset to be frozen.
         * - `issuer`: The new Issuer of this asset.
         * - `admin`: The new Admin of this asset.
         * - `freezer`: The new Freezer of this asset.
         *
         * Emits `TeamChanged`.
         *
         * Weight: `O(1)`
         */
        set_team: TxDescriptor<Anonymize<Icvt3pdunbinm7>>;
        /**
         * Set the metadata for an asset.
         *
         * Origin must be Signed and the sender should be the Owner of the asset `id`.
         *
         * Funds of sender are reserved according to the formula:
         * `MetadataDepositBase + MetadataDepositPerByte * (name.len + symbol.len)` taking into
         * account any already reserved funds.
         *
         * - `id`: The identifier of the asset to update.
         * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
         * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
         * - `decimals`: The number of decimals this asset uses to represent one unit.
         *
         * Emits `MetadataSet`.
         *
         * Weight: `O(1)`
         */
        set_metadata: TxDescriptor<Anonymize<I9ui3n41balr2q>>;
        /**
         * Clear the metadata for an asset.
         *
         * Origin must be Signed and the sender should be the Owner of the asset `id`.
         *
         * Any deposit is freed for the asset owner.
         *
         * - `id`: The identifier of the asset to clear.
         *
         * Emits `MetadataCleared`.
         *
         * Weight: `O(1)`
         */
        clear_metadata: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Force the metadata for an asset to some value.
         *
         * Origin must be ForceOrigin.
         *
         * Any deposit is left alone.
         *
         * - `id`: The identifier of the asset to update.
         * - `name`: The user friendly name of this asset. Limited in length by `StringLimit`.
         * - `symbol`: The exchange symbol for this asset. Limited in length by `StringLimit`.
         * - `decimals`: The number of decimals this asset uses to represent one unit.
         *
         * Emits `MetadataSet`.
         *
         * Weight: `O(N + S)` where N and S are the length of the name and symbol respectively.
         */
        force_set_metadata: TxDescriptor<Anonymize<I89sl7btgl24g2>>;
        /**
         * Clear the metadata for an asset.
         *
         * Origin must be ForceOrigin.
         *
         * Any deposit is returned.
         *
         * - `id`: The identifier of the asset to clear.
         *
         * Emits `MetadataCleared`.
         *
         * Weight: `O(1)`
         */
        force_clear_metadata: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Alter the attributes of a given asset.
         *
         * Origin must be `ForceOrigin`.
         *
         * - `id`: The identifier of the asset.
         * - `owner`: The new Owner of this asset.
         * - `issuer`: The new Issuer of this asset.
         * - `admin`: The new Admin of this asset.
         * - `freezer`: The new Freezer of this asset.
         * - `min_balance`: The minimum balance of this new asset that any single account must
         * have. If an account's balance is reduced below this, then it collapses to zero.
         * - `is_sufficient`: Whether a non-zero balance of this asset is deposit of sufficient
         * value to account for the state bloat associated with its balance storage. If set to
         * `true`, then non-zero balances may be stored without a `consumer` reference (and thus
         * an ED in the Balances pallet or whatever else is used to control user-account state
         * growth).
         * - `is_frozen`: Whether this asset class is frozen except for permissioned/admin
         * instructions.
         *
         * Emits `AssetStatusChanged` with the identity of the asset.
         *
         * Weight: `O(1)`
         */
        force_asset_status: TxDescriptor<Anonymize<I3u6g26k9kn96u>>;
        /**
         * Approve an amount of asset for transfer by a delegated third-party account.
         *
         * Origin must be Signed.
         *
         * Ensures that `ApprovalDeposit` worth of `Currency` is reserved from signing account
         * for the purpose of holding the approval. If some non-zero amount of assets is already
         * approved from signing account to `delegate`, then it is topped up or unreserved to
         * meet the right value.
         *
         * NOTE: The signing account does not need to own `amount` of assets at the point of
         * making this call.
         *
         * - `id`: The identifier of the asset.
         * - `delegate`: The account to delegate permission to transfer asset.
         * - `amount`: The amount of asset that may be transferred by `delegate`. If there is
         * already an approval in place, then this acts additively.
         *
         * Emits `ApprovedTransfer` on success.
         *
         * Weight: `O(1)`
         */
        approve_transfer: TxDescriptor<Anonymize<If1invp94rsjms>>;
        /**
         * Cancel all of some asset approved for delegated transfer by a third-party account.
         *
         * Origin must be Signed and there must be an approval in place between signer and
         * `delegate`.
         *
         * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
         *
         * - `id`: The identifier of the asset.
         * - `delegate`: The account delegated permission to transfer asset.
         *
         * Emits `ApprovalCancelled` on success.
         *
         * Weight: `O(1)`
         */
        cancel_approval: TxDescriptor<Anonymize<Ie5nc19gtiv5sv>>;
        /**
         * Cancel all of some asset approved for delegated transfer by a third-party account.
         *
         * Origin must be either ForceOrigin or Signed origin with the signer being the Admin
         * account of the asset `id`.
         *
         * Unreserves any deposit previously reserved by `approve_transfer` for the approval.
         *
         * - `id`: The identifier of the asset.
         * - `delegate`: The account delegated permission to transfer asset.
         *
         * Emits `ApprovalCancelled` on success.
         *
         * Weight: `O(1)`
         */
        force_cancel_approval: TxDescriptor<Anonymize<Iald3dgvt1hjkb>>;
        /**
         * Transfer some asset balance from a previously delegated account to some third-party
         * account.
         *
         * Origin must be Signed and there must be an approval in place by the `owner` to the
         * signer.
         *
         * If the entire amount approved for transfer is transferred, then any deposit previously
         * reserved by `approve_transfer` is unreserved.
         *
         * - `id`: The identifier of the asset.
         * - `owner`: The account which previously approved for a transfer of at least `amount` and
         * from which the asset balance will be withdrawn.
         * - `destination`: The account to which the asset balance of `amount` will be transferred.
         * - `amount`: The amount of assets to transfer.
         *
         * Emits `TransferredApproved` on success.
         *
         * Weight: `O(1)`
         */
        transfer_approved: TxDescriptor<Anonymize<Iurrhahet4gno>>;
        /**
         * Create an asset account for non-provider assets.
         *
         * A deposit will be taken from the signer account.
         *
         * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
         * to be taken.
         * - `id`: The identifier of the asset for the account to be created.
         *
         * Emits `Touched` event when successful.
         */
        touch: TxDescriptor<Anonymize<Ibsk5g3rhm45pu>>;
        /**
         * Return the deposit (if any) of an asset account or a consumer reference (if any) of an
         * account.
         *
         * The origin must be Signed.
         *
         * - `id`: The identifier of the asset for which the caller would like the deposit
         * refunded.
         * - `allow_burn`: If `true` then assets may be destroyed in order to complete the refund.
         *
         * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
         * the asset account contains holds or freezes in place.
         *
         * Emits `Refunded` event when successful.
         */
        refund: TxDescriptor<Anonymize<I5tamv2nk8bj8o>>;
        /**
         * Sets the minimum balance of an asset.
         *
         * Only works if there aren't any accounts that are holding the asset or if
         * the new value of `min_balance` is less than the old one.
         *
         * Origin must be Signed and the sender has to be the Owner of the
         * asset `id`.
         *
         * - `id`: The identifier of the asset.
         * - `min_balance`: The new value of `min_balance`.
         *
         * Emits `AssetMinBalanceChanged` event when successful.
         */
        set_min_balance: TxDescriptor<Anonymize<I8apq8e7c7qcpp>>;
        /**
         * Create an asset account for `who`.
         *
         * A deposit will be taken from the signer account.
         *
         * - `origin`: Must be Signed; the signer account must have sufficient funds for a deposit
         * to be taken.
         * - `id`: The identifier of the asset for the account to be created, the asset status must
         * be live.
         * - `who`: The account to be created.
         *
         * Emits `Touched` event when successful.
         */
        touch_other: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
        /**
         * Return the deposit (if any) of a target asset account. Useful if you are the depositor.
         *
         * The origin must be Signed and either the account owner, depositor, or asset `Admin`. In
         * order to burn a non-zero balance of the asset, the caller must be the account and should
         * use `refund`.
         *
         * - `id`: The identifier of the asset for the account holding a deposit.
         * - `who`: The account to refund.
         *
         * It will fail with either [`Error::ContainsHolds`] or [`Error::ContainsFreezes`] if
         * the asset account contains holds or freezes in place.
         *
         * Emits `Refunded` event when successful.
         */
        refund_other: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
        /**
         * Disallow further unprivileged transfers of an asset `id` to and from an account `who`.
         *
         * Origin must be Signed and the sender should be the Freezer of the asset `id`.
         *
         * - `id`: The identifier of the account's asset.
         * - `who`: The account to be unblocked.
         *
         * Emits `Blocked`.
         *
         * Weight: `O(1)`
         */
        block: TxDescriptor<Anonymize<Ie4met0joi8sv0>>;
        /**
         * Transfer the entire transferable balance from the caller asset account.
         *
         * NOTE: This function only attempts to transfer _transferable_ balances. This means that
         * any held, frozen, or minimum balance (when `keep_alive` is `true`), will not be
         * transferred by this function. To ensure that this function results in a killed account,
         * you might need to prepare the account by removing any reference counters, storage
         * deposits, etc...
         *
         * The dispatch origin of this call must be Signed.
         *
         * - `id`: The identifier of the asset for the account holding a deposit.
         * - `dest`: The recipient of the transfer.
         * - `keep_alive`: A boolean to determine if the `transfer_all` operation should send all
         * of the funds the asset account has, causing the sender asset account to be killed
         * (false), or transfer everything except at least the minimum balance, which will
         * guarantee to keep the sender asset account alive (true).
         */
        transfer_all: TxDescriptor<Anonymize<Id1e31ij0c35fv>>;
        /**
         * Sets the trusted reserve information of an asset.
         *
         * Origin must be the Owner of the asset `id`. The origin must conform to the configured
         * `CreateOrigin` or be the signed `owner` configured during asset creation.
         *
         * - `id`: The identifier of the asset.
         * - `reserves`: The full list of trusted reserves information.
         *
         * Emits `AssetMinBalanceChanged` event when successful.
         */
        set_reserves: TxDescriptor<Anonymize<Ic6vatc0h2tbq8>>;
    };
    AssetRate: {
        /**
         * Initialize a conversion rate to native balance for the given asset.
         *
         * ## Complexity
         * - O(1)
         */
        create: TxDescriptor<Anonymize<I72jcvr86rnvv8>>;
        /**
         * Update the conversion rate to native balance for the given asset.
         *
         * ## Complexity
         * - O(1)
         */
        update: TxDescriptor<Anonymize<I72jcvr86rnvv8>>;
        /**
         * Remove an existing conversion rate to native balance for the given asset.
         *
         * ## Complexity
         * - O(1)
         */
        remove: TxDescriptor<Anonymize<I90c919drss29e>>;
    };
    CollatorSelection: {
        /**
         * Set the list of invulnerable (fixed) collators. These collators must do some
         * preparation, namely to have registered session keys.
         *
         * The call will remove any accounts that have not registered keys from the set. That is,
         * it is non-atomic; the caller accepts all `AccountId`s passed in `new` _individually_ as
         * acceptable Invulnerables, and is not proposing a _set_ of new Invulnerables.
         *
         * This call does not maintain mutual exclusivity of `Invulnerables` and `Candidates`. It
         * is recommended to use a batch of `add_invulnerable` and `remove_invulnerable` instead. A
         * `batch_all` can also be used to enforce atomicity. If any candidates are included in
         * `new`, they should be removed with `remove_invulnerable_candidate` after execution.
         *
         * Must be called by the `UpdateOrigin`.
         */
        set_invulnerables: TxDescriptor<Anonymize<Ifccifqltb5obi>>;
        /**
         * Set the ideal number of non-invulnerable collators. If lowering this number, then the
         * number of running collators could be higher than this figure. Aside from that edge case,
         * there should be no other way to have more candidates than the desired number.
         *
         * The origin for this call must be the `UpdateOrigin`.
         */
        set_desired_candidates: TxDescriptor<Anonymize<Iadtsfv699cq8b>>;
        /**
         * Set the candidacy bond amount.
         *
         * If the candidacy bond is increased by this call, all current candidates which have a
         * deposit lower than the new bond will be kicked from the list and get their deposits
         * back.
         *
         * The origin for this call must be the `UpdateOrigin`.
         */
        set_candidacy_bond: TxDescriptor<Anonymize<Ialpmgmhr3gk5r>>;
        /**
         * Register this account as a collator candidate. The account must (a) already have
         * registered session keys and (b) be able to reserve the `CandidacyBond`.
         *
         * This call is not available to `Invulnerable` collators.
         */
        register_as_candidate: TxDescriptor<undefined>;
        /**
         * Deregister `origin` as a collator candidate. Note that the collator can only leave on
         * session change. The `CandidacyBond` will be unreserved immediately.
         *
         * This call will fail if the total number of candidates would drop below
         * `MinEligibleCollators`.
         */
        leave_intent: TxDescriptor<undefined>;
        /**
         * Add a new account `who` to the list of `Invulnerables` collators. `who` must have
         * registered session keys. If `who` is a candidate, they will be removed.
         *
         * The origin for this call must be the `UpdateOrigin`.
         */
        add_invulnerable: TxDescriptor<Anonymize<I4cbvqmqadhrea>>;
        /**
         * Remove an account `who` from the list of `Invulnerables` collators. `Invulnerables` must
         * be sorted.
         *
         * The origin for this call must be the `UpdateOrigin`.
         */
        remove_invulnerable: TxDescriptor<Anonymize<I4cbvqmqadhrea>>;
        /**
         * Update the candidacy bond of collator candidate `origin` to a new amount `new_deposit`.
         *
         * Setting a `new_deposit` that is lower than the current deposit while `origin` is
         * occupying a top-`DesiredCandidates` slot is not allowed.
         *
         * This call will fail if `origin` is not a collator candidate, the updated bond is lower
         * than the minimum candidacy bond, and/or the amount cannot be reserved.
         */
        update_bond: TxDescriptor<Anonymize<I3sdol54kg5jaq>>;
        /**
         * The caller `origin` replaces a candidate `target` in the collator candidate list by
         * reserving `deposit`. The amount `deposit` reserved by the caller must be greater than
         * the existing bond of the target it is trying to replace.
         *
         * This call will fail if the caller is already a collator candidate or invulnerable, the
         * caller does not have registered session keys, the target is not a collator candidate,
         * and/or the `deposit` amount cannot be reserved.
         */
        take_candidate_slot: TxDescriptor<Anonymize<I8fougodaj6di6>>;
    };
    Session: {
        /**
         * Sets the session key(s) of the function caller to `keys`.
         *
         * Allows an account to set its session key prior to becoming a validator.
         * This doesn't take effect until the next session.
         *
         * - `origin`: The dispatch origin of this function must be signed.
         * - `keys`: The new session keys to set. These are the public keys of all sessions keys
         * setup in the runtime.
         * - `proof`: The proof that `origin` has access to the private keys of `keys`. See
         * [`impl_opaque_keys`](sp_runtime::impl_opaque_keys) for more information about the
         * proof format.
         */
        set_keys: TxDescriptor<Anonymize<I81vt5eq60l4b6>>;
        /**
         * Removes any session key(s) of the function caller.
         *
         * This doesn't take effect until the next session.
         *
         * The dispatch origin of this function must be Signed and the account must be either be
         * convertible to a validator ID using the chain's typical addressing system (this usually
         * means being a controller account) or directly convertible into a validator ID (which
         * usually means being a stash account).
         */
        purge_keys: TxDescriptor<undefined>;
    };
    XcmpQueue: {
        /**
         * Suspends all XCM executions for the XCMP queue, regardless of the sender's origin.
         *
         * - `origin`: Must pass `ControllerOrigin`.
         */
        suspend_xcm_execution: TxDescriptor<undefined>;
        /**
         * Resumes all XCM executions for the XCMP queue.
         *
         * Note that this function doesn't change the status of the in/out bound channels.
         *
         * - `origin`: Must pass `ControllerOrigin`.
         */
        resume_xcm_execution: TxDescriptor<undefined>;
        /**
         * Overwrites the number of pages which must be in the queue for the other side to be
         * told to suspend their sending.
         *
         * - `origin`: Must pass `Root`.
         * - `new`: Desired value for `QueueConfigData.suspend_value`
         */
        update_suspend_threshold: TxDescriptor<Anonymize<I3vh014cqgmrfd>>;
        /**
         * Overwrites the number of pages which must be in the queue after which we drop any
         * further messages from the channel.
         *
         * - `origin`: Must pass `Root`.
         * - `new`: Desired value for `QueueConfigData.drop_threshold`
         */
        update_drop_threshold: TxDescriptor<Anonymize<I3vh014cqgmrfd>>;
        /**
         * Overwrites the number of pages which the queue must be reduced to before it signals
         * that message sending may recommence after it has been suspended.
         *
         * - `origin`: Must pass `Root`.
         * - `new`: Desired value for `QueueConfigData.resume_threshold`
         */
        update_resume_threshold: TxDescriptor<Anonymize<I3vh014cqgmrfd>>;
    };
    PolkadotXcm: {
        /**
        
         */
        send: TxDescriptor<Anonymize<Ia5cotcvi888ln>>;
        /**
         * Teleport some assets from the local chain to some destination chain.
         *
         * **This function is deprecated: Use `limited_teleport_assets` instead.**
         *
         * Fee payment on the destination side is made from the asset in the `assets` vector of
         * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
         * with all fees taken as needed from the asset.
         *
         * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
         * - `dest`: Destination context for the assets. Will typically be `[Parent,
         * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
         * relay to parachain.
         * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
         * generally be an `AccountId32` value.
         * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
         * fee on the `dest` chain.
         * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
         * fees.
         */
        teleport_assets: TxDescriptor<Anonymize<I21jsa919m88fd>>;
        /**
         * Transfer some assets from the local chain to the destination chain through their local,
         * destination or remote reserve.
         *
         * `assets` must have same reserve location and may not be teleportable to `dest`.
         * - `assets` have local reserve: transfer assets to sovereign account of destination
         * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
         * assets to `beneficiary`.
         * - `assets` have destination reserve: burn local assets and forward a notification to
         * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
         * deposit them to `beneficiary`.
         * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
         * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
         * to mint and deposit reserve-based assets to `beneficiary`.
         *
         * **This function is deprecated: Use `limited_reserve_transfer_assets` instead.**
         *
         * Fee payment on the destination side is made from the asset in the `assets` vector of
         * index `fee_asset_item`. The weight limit for fees is not provided and thus is unlimited,
         * with all fees taken as needed from the asset.
         *
         * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
         * - `dest`: Destination context for the assets. Will typically be `[Parent,
         * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
         * relay to parachain.
         * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
         * generally be an `AccountId32` value.
         * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
         * fee on the `dest` (and possibly reserve) chains.
         * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
         * fees.
         */
        reserve_transfer_assets: TxDescriptor<Anonymize<I21jsa919m88fd>>;
        /**
         * Execute an XCM message from a local, signed, origin.
         *
         * An event is deposited indicating whether `msg` could be executed completely or only
         * partially.
         *
         * No more than `max_weight` will be used in its attempted execution. If this is less than
         * the maximum amount of weight that the message could take to be executed, then no
         * execution attempt will be made.
         */
        execute: TxDescriptor<Anonymize<Iegif7m3upfe1k>>;
        /**
         * Extoll that a particular destination can be communicated with through a particular
         * version of XCM.
         *
         * - `origin`: Must be an origin specified by AdminOrigin.
         * - `location`: The destination that is being described.
         * - `xcm_version`: The latest version of XCM that `location` supports.
         */
        force_xcm_version: TxDescriptor<Anonymize<I9kt8c221c83ln>>;
        /**
         * Set a safe XCM version (the version that XCM should be encoded with if the most recent
         * version a destination can accept is unknown).
         *
         * - `origin`: Must be an origin specified by AdminOrigin.
         * - `maybe_xcm_version`: The default XCM encoding version, or `None` to disable.
         */
        force_default_xcm_version: TxDescriptor<Anonymize<Ic76kfh5ebqkpl>>;
        /**
         * Ask a location to notify us regarding their XCM version and any changes to it.
         *
         * - `origin`: Must be an origin specified by AdminOrigin.
         * - `location`: The location to which we should subscribe for XCM version notifications.
         */
        force_subscribe_version_notify: TxDescriptor<Anonymize<Icscpmubum33bq>>;
        /**
         * Require that a particular destination should no longer notify us regarding any XCM
         * version changes.
         *
         * - `origin`: Must be an origin specified by AdminOrigin.
         * - `location`: The location to which we are currently subscribed for XCM version
         * notifications which we no longer desire.
         */
        force_unsubscribe_version_notify: TxDescriptor<Anonymize<Icscpmubum33bq>>;
        /**
         * Transfer some assets from the local chain to the destination chain through their local,
         * destination or remote reserve.
         *
         * `assets` must have same reserve location and may not be teleportable to `dest`.
         * - `assets` have local reserve: transfer assets to sovereign account of destination
         * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
         * assets to `beneficiary`.
         * - `assets` have destination reserve: burn local assets and forward a notification to
         * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
         * deposit them to `beneficiary`.
         * - `assets` have remote reserve: burn local assets, forward XCM to reserve chain to move
         * reserves from this chain's SA to `dest` chain's SA, and forward another XCM to `dest`
         * to mint and deposit reserve-based assets to `beneficiary`.
         *
         * Fee payment on the destination side is made from the asset in the `assets` vector of
         * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
         * is needed than `weight_limit`, then the operation will fail and the sent assets may be
         * at risk.
         *
         * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
         * - `dest`: Destination context for the assets. Will typically be `[Parent,
         * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
         * relay to parachain.
         * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
         * generally be an `AccountId32` value.
         * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
         * fee on the `dest` (and possibly reserve) chains.
         * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
         * fees.
         * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
         */
        limited_reserve_transfer_assets: TxDescriptor<Anonymize<I21d2olof7eb60>>;
        /**
         * Teleport some assets from the local chain to some destination chain.
         *
         * Fee payment on the destination side is made from the asset in the `assets` vector of
         * index `fee_asset_item`, up to enough to pay for `weight_limit` of weight. If more weight
         * is needed than `weight_limit`, then the operation will fail and the sent assets may be
         * at risk.
         *
         * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
         * - `dest`: Destination context for the assets. Will typically be `[Parent,
         * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
         * relay to parachain.
         * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
         * generally be an `AccountId32` value.
         * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
         * fee on the `dest` chain.
         * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
         * fees.
         * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
         */
        limited_teleport_assets: TxDescriptor<Anonymize<I21d2olof7eb60>>;
        /**
         * Set or unset the global suspension state of the XCM executor.
         *
         * - `origin`: Must be an origin specified by AdminOrigin.
         * - `suspended`: `true` to suspend, `false` to resume.
         */
        force_suspension: TxDescriptor<Anonymize<Ibgm4rnf22lal1>>;
        /**
         * Transfer some assets from the local chain to the destination chain through their local,
         * destination or remote reserve, or through teleports.
         *
         * Fee payment on the destination side is made from the asset in the `assets` vector of
         * index `fee_asset_item` (hence referred to as `fees`), up to enough to pay for
         * `weight_limit` of weight. If more weight is needed than `weight_limit`, then the
         * operation will fail and the sent assets may be at risk.
         *
         * `assets` (excluding `fees`) must have same reserve location or otherwise be teleportable
         * to `dest`, no limitations imposed on `fees`.
         * - for local reserve: transfer assets to sovereign account of destination chain and
         * forward a notification XCM to `dest` to mint and deposit reserve-based assets to
         * `beneficiary`.
         * - for destination reserve: burn local assets and forward a notification to `dest` chain
         * to withdraw the reserve assets from this chain's sovereign account and deposit them
         * to `beneficiary`.
         * - for remote reserve: burn local assets, forward XCM to reserve chain to move reserves
         * from this chain's SA to `dest` chain's SA, and forward another XCM to `dest` to mint
         * and deposit reserve-based assets to `beneficiary`.
         * - for teleports: burn local assets and forward XCM to `dest` chain to mint/teleport
         * assets and deposit them to `beneficiary`.
         *
         * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
         * - `dest`: Destination context for the assets. Will typically be `X2(Parent,
         * Parachain(..))` to send from parachain to parachain, or `X1(Parachain(..))` to send
         * from relay to parachain.
         * - `beneficiary`: A beneficiary location for the assets in the context of `dest`. Will
         * generally be an `AccountId32` value.
         * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
         * fee on the `dest` (and possibly reserve) chains.
         * - `fee_asset_item`: The index into `assets` of the item which should be used to pay
         * fees.
         * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
         */
        transfer_assets: TxDescriptor<Anonymize<I21d2olof7eb60>>;
        /**
         * Claims assets trapped on this pallet because of leftover assets during XCM execution.
         *
         * - `origin`: Anyone can call this extrinsic.
         * - `assets`: The exact assets that were trapped. Use the version to specify what version
         * was the latest when they were trapped.
         * - `beneficiary`: The location/account where the claimed assets will be deposited.
         */
        claim_assets: TxDescriptor<Anonymize<Ie68np0vpihith>>;
        /**
         * Transfer assets from the local chain to the destination chain using explicit transfer
         * types for assets and fees.
         *
         * `assets` must have same reserve location or may be teleportable to `dest`. Caller must
         * provide the `assets_transfer_type` to be used for `assets`:
         * - `TransferType::LocalReserve`: transfer assets to sovereign account of destination
         * chain and forward a notification XCM to `dest` to mint and deposit reserve-based
         * assets to `beneficiary`.
         * - `TransferType::DestinationReserve`: burn local assets and forward a notification to
         * `dest` chain to withdraw the reserve assets from this chain's sovereign account and
         * deposit them to `beneficiary`.
         * - `TransferType::RemoteReserve(reserve)`: burn local assets, forward XCM to `reserve`
         * chain to move reserves from this chain's SA to `dest` chain's SA, and forward another
         * XCM to `dest` to mint and deposit reserve-based assets to `beneficiary`. Typically
         * the remote `reserve` is Asset Hub.
         * - `TransferType::Teleport`: burn local assets and forward XCM to `dest` chain to
         * mint/teleport assets and deposit them to `beneficiary`.
         *
         * On the destination chain, as well as any intermediary hops, `BuyExecution` is used to
         * buy execution using transferred `assets` identified by `remote_fees_id`.
         * Make sure enough of the specified `remote_fees_id` asset is included in the given list
         * of `assets`. `remote_fees_id` should be enough to pay for `weight_limit`. If more weight
         * is needed than `weight_limit`, then the operation will fail and the sent assets may be
         * at risk.
         *
         * `remote_fees_id` may use different transfer type than rest of `assets` and can be
         * specified through `fees_transfer_type`.
         *
         * The caller needs to specify what should happen to the transferred assets once they reach
         * the `dest` chain. This is done through the `custom_xcm_on_dest` parameter, which
         * contains the instructions to execute on `dest` as a final step.
         * This is usually as simple as:
         * `Xcm(vec![DepositAsset { assets: Wild(AllCounted(assets.len())), beneficiary }])`,
         * but could be something more exotic like sending the `assets` even further.
         *
         * - `origin`: Must be capable of withdrawing the `assets` and executing XCM.
         * - `dest`: Destination context for the assets. Will typically be `[Parent,
         * Parachain(..)]` to send from parachain to parachain, or `[Parachain(..)]` to send from
         * relay to parachain, or `(parents: 2, (GlobalConsensus(..), ..))` to send from
         * parachain across a bridge to another ecosystem destination.
         * - `assets`: The assets to be withdrawn. This should include the assets used to pay the
         * fee on the `dest` (and possibly reserve) chains.
         * - `assets_transfer_type`: The XCM `TransferType` used to transfer the `assets`.
         * - `remote_fees_id`: One of the included `assets` to be used to pay fees.
         * - `fees_transfer_type`: The XCM `TransferType` used to transfer the `fees` assets.
         * - `custom_xcm_on_dest`: The XCM to be executed on `dest` chain as the last step of the
         * transfer, which also determines what happens to the assets on the destination chain.
         * - `weight_limit`: The remote-side weight limit, if any, for the XCM fee purchase.
         */
        transfer_assets_using_type_and_then: TxDescriptor<Anonymize<I9bnv6lu0crf1q>>;
        /**
         * Authorize another `aliaser` location to alias into the local `origin` making this call.
         * The `aliaser` is only authorized until the provided `expiry` block number.
         * The call can also be used for a previously authorized alias in order to update its
         * `expiry` block number.
         *
         * Usually useful to allow your local account to be aliased into from a remote location
         * also under your control (like your account on another chain).
         *
         * WARNING: make sure the caller `origin` (you) trusts the `aliaser` location to act in
         * their/your name. Once authorized using this call, the `aliaser` can freely impersonate
         * `origin` in XCM programs executed on the local chain.
         */
        add_authorized_alias: TxDescriptor<Anonymize<Iauhjqifrdklq7>>;
        /**
         * Remove a previously authorized `aliaser` from the list of locations that can alias into
         * the local `origin` making this call.
         */
        remove_authorized_alias: TxDescriptor<Anonymize<Ie1uso9m8rt5cf>>;
        /**
         * Remove all previously authorized `aliaser`s that can alias into the local `origin`
         * making this call.
         */
        remove_all_authorized_aliases: TxDescriptor<undefined>;
    };
    MessageQueue: {
        /**
         * Remove a page which has no more messages remaining to be processed or is stale.
         */
        reap_page: TxDescriptor<Anonymize<I40pqum1mu8qg3>>;
        /**
         * Execute an overweight message.
         *
         * Temporary processing errors will be propagated whereas permanent errors are treated
         * as success condition.
         *
         * - `origin`: Must be `Signed`.
         * - `message_origin`: The origin from which the message to be executed arrived.
         * - `page`: The page in the queue in which the message to be executed is sitting.
         * - `index`: The index into the queue of the message to be executed.
         * - `weight_limit`: The maximum amount of weight allowed to be consumed in the execution
         * of the message.
         *
         * Benchmark complexity considerations: O(index + weight_limit).
         */
        execute_overweight: TxDescriptor<Anonymize<I1r4c2ghbtvjuc>>;
    };
    Utility: {
        /**
         * Send a batch of dispatch calls.
         *
         * May be called from any origin except `None`.
         *
         * - `calls`: The calls to be dispatched from the same origin. The number of call must not
         * exceed the constant: `batched_calls_limit` (available in constant metadata).
         *
         * If origin is root then the calls are dispatched without checking origin filter. (This
         * includes bypassing `frame_system::Config::BaseCallFilter`).
         *
         * ## Complexity
         * - O(C) where C is the number of calls to be batched.
         *
         * This will return `Ok` in all circumstances. To determine the success of the batch, an
         * event is deposited. If a call failed and the batch was interrupted, then the
         * `BatchInterrupted` event is deposited, along with the number of successful calls made
         * and the error of the failed call. If all were successful, then the `BatchCompleted`
         * event is deposited.
         */
        batch: TxDescriptor<Anonymize<I31fb7db4bv6ln>>;
        /**
         * Send a call through an indexed pseudonym of the sender.
         *
         * Filter from origin are passed along. The call will be dispatched with an origin which
         * use the same filter as the origin of this call.
         *
         * NOTE: If you need to ensure that any account-based filtering is not honored (i.e.
         * because you expect `proxy` to have been used prior in the call stack and you do not want
         * the call restrictions to apply to any sub-accounts), then use `as_multi_threshold_1`
         * in the Multisig pallet instead.
         *
         * NOTE: Prior to version *12, this was called `as_limited_sub`.
         *
         * The dispatch origin for this call must be _Signed_.
         */
        as_derivative: TxDescriptor<Anonymize<I6prj085oihphp>>;
        /**
         * Send a batch of dispatch calls and atomically execute them.
         * The whole transaction will rollback and fail if any of the calls failed.
         *
         * May be called from any origin except `None`.
         *
         * - `calls`: The calls to be dispatched from the same origin. The number of call must not
         * exceed the constant: `batched_calls_limit` (available in constant metadata).
         *
         * If origin is root then the calls are dispatched without checking origin filter. (This
         * includes bypassing `frame_system::Config::BaseCallFilter`).
         *
         * ## Complexity
         * - O(C) where C is the number of calls to be batched.
         */
        batch_all: TxDescriptor<Anonymize<I31fb7db4bv6ln>>;
        /**
         * Dispatches a function call with a provided origin.
         *
         * The dispatch origin for this call must be _Root_.
         *
         * ## Complexity
         * - O(1).
         */
        dispatch_as: TxDescriptor<Anonymize<I44m1vft5l6o06>>;
        /**
         * Send a batch of dispatch calls.
         * Unlike `batch`, it allows errors and won't interrupt.
         *
         * May be called from any origin except `None`.
         *
         * - `calls`: The calls to be dispatched from the same origin. The number of call must not
         * exceed the constant: `batched_calls_limit` (available in constant metadata).
         *
         * If origin is root then the calls are dispatch without checking origin filter. (This
         * includes bypassing `frame_system::Config::BaseCallFilter`).
         *
         * ## Complexity
         * - O(C) where C is the number of calls to be batched.
         */
        force_batch: TxDescriptor<Anonymize<I31fb7db4bv6ln>>;
        /**
         * Dispatch a function call with a specified weight.
         *
         * This function does not check the weight of the call, and instead allows the
         * Root origin to specify the weight of the call.
         *
         * The dispatch origin for this call must be _Root_.
         */
        with_weight: TxDescriptor<Anonymize<Iabas7l138cqgj>>;
        /**
         * Dispatch a fallback call in the event the main call fails to execute.
         * May be called from any origin except `None`.
         *
         * This function first attempts to dispatch the `main` call.
         * If the `main` call fails, the `fallback` is attemted.
         * if the fallback is successfully dispatched, the weights of both calls
         * are accumulated and an event containing the main call error is deposited.
         *
         * In the event of a fallback failure the whole call fails
         * with the weights returned.
         *
         * - `main`: The main call to be dispatched. This is the primary action to execute.
         * - `fallback`: The fallback call to be dispatched in case the `main` call fails.
         *
         * ## Dispatch Logic
         * - If the origin is `root`, both the main and fallback calls are executed without
         * applying any origin filters.
         * - If the origin is not `root`, the origin filter is applied to both the `main` and
         * `fallback` calls.
         *
         * ## Use Case
         * - Some use cases might involve submitting a `batch` type call in either main, fallback
         * or both.
         */
        if_else: TxDescriptor<Anonymize<I6e58ba477s4l4>>;
        /**
         * Dispatches a function call with a provided origin.
         *
         * Almost the same as [`Pallet::dispatch_as`] but forwards any error of the inner call.
         *
         * The dispatch origin for this call must be _Root_.
         */
        dispatch_as_fallible: TxDescriptor<Anonymize<I44m1vft5l6o06>>;
    };
    Multisig: {
        /**
         * Immediately dispatch a multi-signature call using a single approval from the caller.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * - `other_signatories`: The accounts (other than the sender) who are part of the
         * multi-signature, but do not participate in the approval process.
         * - `call`: The call to be executed.
         *
         * Result is equivalent to the dispatched result.
         *
         * ## Complexity
         * O(Z + C) where Z is the length of the call and C its execution weight.
         */
        as_multi_threshold_1: TxDescriptor<Anonymize<Iccoh7s156h15i>>;
        /**
         * Register approval for a dispatch to be made from a deterministic composite account if
         * approved by a total of `threshold - 1` of `other_signatories`.
         *
         * **If the approval threshold is met (including the sender's approval), this will
         * immediately execute the call.** This is the only way to execute a multisig call -
         * `approve_as_multi` will never trigger execution.
         *
         * Payment: `DepositBase` will be reserved if this is the first approval, plus
         * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
         * is cancelled.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * - `threshold`: The total number of approvals for this dispatch before it is executed.
         * - `other_signatories`: The accounts (other than the sender) who can approve this
         * dispatch. May not be empty.
         * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
         * not the first approval, then it must be `Some`, with the timepoint (block number and
         * transaction index) of the first approval transaction.
         * - `call`: The call to be executed.
         *
         * NOTE: For intermediate approvals (not the final approval), you should generally use
         * `approve_as_multi` instead, since it only requires a hash of the call and is more
         * efficient.
         *
         * Result is equivalent to the dispatched result if `threshold` is exactly `1`. Otherwise
         * on success, result is `Ok` and the result from the interior call, if it was executed,
         * may be found in the deposited `MultisigExecuted` event.
         *
         * ## Complexity
         * - `O(S + Z + Call)`.
         * - Up to one balance-reserve or unreserve operation.
         * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
         * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
         * - One call encode & hash, both of complexity `O(Z)` where `Z` is tx-len.
         * - One encode & hash, both of complexity `O(S)`.
         * - Up to one binary search and insert (`O(logS + S)`).
         * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
         * - One event.
         * - The weight of the `call`.
         * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
         * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
         */
        as_multi: TxDescriptor<Anonymize<I3kqaqg9krebsk>>;
        /**
         * Register approval for a dispatch to be made from a deterministic composite account if
         * approved by a total of `threshold - 1` of `other_signatories`.
         *
         * **This function will NEVER execute the call, even if the approval threshold is
         * reached.** It only registers approval. To actually execute the call, `as_multi` must
         * be called with the full call data by any of the signatories.
         *
         * This function is more efficient than `as_multi` for intermediate approvals since it
         * only requires the call hash, not the full call data.
         *
         * Payment: `DepositBase` will be reserved if this is the first approval, plus
         * `threshold` times `DepositFactor`. It is returned once this dispatch happens or
         * is cancelled.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * - `threshold`: The total number of approvals for this dispatch before it is executed.
         * - `other_signatories`: The accounts (other than the sender) who can approve this
         * dispatch. May not be empty.
         * - `maybe_timepoint`: If this is the first approval, then this must be `None`. If it is
         * not the first approval, then it must be `Some`, with the timepoint (block number and
         * transaction index) of the first approval transaction.
         * - `call_hash`: The hash of the call to be executed.
         *
         * NOTE: To execute the call after approvals are gathered, any signatory must call
         * `as_multi` with the full call data. This function cannot execute the call.
         *
         * ## Complexity
         * - `O(S)`.
         * - Up to one balance-reserve or unreserve operation.
         * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
         * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
         * - One encode & hash, both of complexity `O(S)`.
         * - Up to one binary search and insert (`O(logS + S)`).
         * - I/O: 1 read `O(S)`, up to 1 mutate `O(S)`. Up to one remove.
         * - One event.
         * - Storage: inserts one item, value size bounded by `MaxSignatories`, with a deposit
         * taken for its lifetime of `DepositBase + threshold * DepositFactor`.
         */
        approve_as_multi: TxDescriptor<Anonymize<Ideaemvoneh309>>;
        /**
         * Cancel a pre-existing, on-going multisig transaction. Any deposit reserved previously
         * for this operation will be unreserved on success.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * - `threshold`: The total number of approvals for this dispatch before it is executed.
         * - `other_signatories`: The accounts (other than the sender) who can approve this
         * dispatch. May not be empty.
         * - `timepoint`: The timepoint (block number and transaction index) of the first approval
         * transaction for this dispatch.
         * - `call_hash`: The hash of the call to be executed.
         *
         * ## Complexity
         * - `O(S)`.
         * - Up to one balance-reserve or unreserve operation.
         * - One passthrough operation, one insert, both `O(S)` where `S` is the number of
         * signatories. `S` is capped by `MaxSignatories`, with weight being proportional.
         * - One encode & hash, both of complexity `O(S)`.
         * - One event.
         * - I/O: 1 read `O(S)`, one remove.
         * - Storage: removes one item.
         */
        cancel_as_multi: TxDescriptor<Anonymize<I3d9o9d7epp66v>>;
        /**
         * Poke the deposit reserved for an existing multisig operation.
         *
         * The dispatch origin for this call must be _Signed_ and must be the original depositor of
         * the multisig operation.
         *
         * The transaction fee is waived if the deposit amount has changed.
         *
         * - `threshold`: The total number of approvals needed for this multisig.
         * - `other_signatories`: The accounts (other than the sender) who are part of the
         * multisig.
         * - `call_hash`: The hash of the call this deposit is reserved for.
         *
         * Emits `DepositPoked` if successful.
         */
        poke_deposit: TxDescriptor<Anonymize<I6lqh1vgb4mcja>>;
    };
    Sudo: {
        /**
         * Authenticates the sudo key and dispatches a function call with `Root` origin.
         */
        sudo: TxDescriptor<Anonymize<Iejcklm1m5ig5m>>;
        /**
         * Authenticates the sudo key and dispatches a function call with `Root` origin.
         * This function does not check the weight of the call, and instead allows the
         * Sudo user to specify the weight of the call.
         *
         * The dispatch origin for this call must be _Signed_.
         */
        sudo_unchecked_weight: TxDescriptor<Anonymize<Iabas7l138cqgj>>;
        /**
         * Authenticates the current sudo key and sets the given AccountId (`new`) as the new sudo
         * key.
         */
        set_key: TxDescriptor<Anonymize<I8k3rnvpeeh4hv>>;
        /**
         * Authenticates the sudo key and dispatches a function call with `Signed` origin from
         * a given account.
         *
         * The dispatch origin for this call must be _Signed_.
         */
        sudo_as: TxDescriptor<Anonymize<I440d6i17jrfje>>;
        /**
         * Permanently removes the sudo key.
         *
         * **This cannot be un-done.**
         */
        remove_key: TxDescriptor<undefined>;
    };
    Proxy: {
        /**
         * Dispatch the given `call` from an account that the sender is authorised for through
         * `add_proxy`.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * Parameters:
         * - `real`: The account that the proxy will make a call on behalf of.
         * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
         * - `call`: The call to be made by the `real` account.
         */
        proxy: TxDescriptor<Anonymize<I9v6oij2c2ajai>>;
        /**
         * Register a proxy account for the sender that is able to make calls on its behalf.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * Parameters:
         * - `proxy`: The account that the `caller` would like to make a proxy.
         * - `proxy_type`: The permissions allowed for this proxy account.
         * - `delay`: The announcement period required of the initial proxy. Will generally be
         * zero.
         */
        add_proxy: TxDescriptor<Anonymize<I6hk7temg1mga7>>;
        /**
         * Unregister a proxy account for the sender.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * Parameters:
         * - `proxy`: The account that the `caller` would like to remove as a proxy.
         * - `proxy_type`: The permissions currently enabled for the removed proxy account.
         */
        remove_proxy: TxDescriptor<Anonymize<I6hk7temg1mga7>>;
        /**
         * Unregister all proxy accounts for the sender.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * WARNING: This may be called on accounts created by `create_pure`, however if done, then
         * the unreserved fees will be inaccessible. **All access to this account will be lost.**
         */
        remove_proxies: TxDescriptor<undefined>;
        /**
         * Spawn a fresh new account that is guaranteed to be otherwise inaccessible, and
         * initialize it with a proxy of `proxy_type` for `origin` sender.
         *
         * Requires a `Signed` origin.
         *
         * - `proxy_type`: The type of the proxy that the sender will be registered as over the
         * new account. This will almost always be the most permissive `ProxyType` possible to
         * allow for maximum flexibility.
         * - `index`: A disambiguation index, in case this is called multiple times in the same
         * transaction (e.g. with `utility::batch`). Unless you're using `batch` you probably just
         * want to use `0`.
         * - `delay`: The announcement period required of the initial proxy. Will generally be
         * zero.
         *
         * Fails with `Duplicate` if this has already been called in this transaction, from the
         * same sender, with the same parameters.
         *
         * Fails if there are insufficient funds to pay for deposit.
         */
        create_pure: TxDescriptor<Anonymize<I2lbmfajhc5gdu>>;
        /**
         * Removes a previously spawned pure proxy.
         *
         * WARNING: **All access to this account will be lost.** Any funds held in it will be
         * inaccessible.
         *
         * Requires a `Signed` origin, and the sender account must have been created by a call to
         * `create_pure` with corresponding parameters.
         *
         * - `spawner`: The account that originally called `create_pure` to create this account.
         * - `index`: The disambiguation index originally passed to `create_pure`. Probably `0`.
         * - `proxy_type`: The proxy type originally passed to `create_pure`.
         * - `height`: The height of the chain when the call to `create_pure` was processed.
         * - `ext_index`: The extrinsic index in which the call to `create_pure` was processed.
         *
         * Fails with `NoPermission` in case the caller is not a previously created pure
         * account whose `create_pure` call has corresponding parameters.
         */
        kill_pure: TxDescriptor<Anonymize<I2siheq6f2djrd>>;
        /**
         * Publish the hash of a proxy-call that will be made in the future.
         *
         * This must be called some number of blocks before the corresponding `proxy` is attempted
         * if the delay associated with the proxy relationship is greater than zero.
         *
         * No more than `MaxPending` announcements may be made at any one time.
         *
         * This will take a deposit of `AnnouncementDepositFactor` as well as
         * `AnnouncementDepositBase` if there are no other pending announcements.
         *
         * The dispatch origin for this call must be _Signed_ and a proxy of `real`.
         *
         * Parameters:
         * - `real`: The account that the proxy will make a call on behalf of.
         * - `call_hash`: The hash of the call to be made by the `real` account.
         */
        announce: TxDescriptor<Anonymize<I2eb501t8s6hsq>>;
        /**
         * Remove a given announcement.
         *
         * May be called by a proxy account to remove a call they previously announced and return
         * the deposit.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * Parameters:
         * - `real`: The account that the proxy will make a call on behalf of.
         * - `call_hash`: The hash of the call to be made by the `real` account.
         */
        remove_announcement: TxDescriptor<Anonymize<I2eb501t8s6hsq>>;
        /**
         * Remove the given announcement of a delegate.
         *
         * May be called by a target (proxied) account to remove a call that one of their delegates
         * (`delegate`) has announced they want to execute. The deposit is returned.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * Parameters:
         * - `delegate`: The account that previously announced the call.
         * - `call_hash`: The hash of the call to be made.
         */
        reject_announcement: TxDescriptor<Anonymize<Ianmuoljk2sk1u>>;
        /**
         * Dispatch the given `call` from an account that the sender is authorized for through
         * `add_proxy`.
         *
         * Removes any corresponding announcement(s).
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * Parameters:
         * - `real`: The account that the proxy will make a call on behalf of.
         * - `force_proxy_type`: Specify the exact proxy type to be used and checked for this call.
         * - `call`: The call to be made by the `real` account.
         */
        proxy_announced: TxDescriptor<Anonymize<I3dqpogh1f1c93>>;
        /**
         * Poke / Adjust deposits made for proxies and announcements based on current values.
         * This can be used by accounts to possibly lower their locked amount.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * The transaction fee is waived if the deposit amount has changed.
         *
         * Emits `DepositPoked` if successful.
         */
        poke_deposit: TxDescriptor<undefined>;
    };
    Identity: {
        /**
         * Add a registrar to the system.
         *
         * The dispatch origin for this call must be `T::RegistrarOrigin`.
         *
         * - `account`: the account of the registrar.
         *
         * Emits `RegistrarAdded` if successful.
         */
        add_registrar: TxDescriptor<Anonymize<Ic6cqd9g0t65v0>>;
        /**
         * Set an account's identity information and reserve the appropriate deposit.
         *
         * If the account already has identity information, the deposit is taken as part payment
         * for the new deposit.
         *
         * The dispatch origin for this call must be _Signed_.
         *
         * - `info`: The identity information.
         *
         * Emits `IdentitySet` if successful.
         */
        set_identity: TxDescriptor<Anonymize<I5sv83ib1q5mod>>;
        /**
         * Set the sub-accounts of the sender.
         *
         * Payment: Any aggregate balance reserved by previous `set_subs` calls will be returned
         * and an amount `SubAccountDeposit` will be reserved for each item in `subs`.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a registered
         * identity.
         *
         * - `subs`: The identity's (new) sub-accounts.
         */
        set_subs: TxDescriptor<Anonymize<Ia9mkdf6l44shb>>;
        /**
         * Clear an account's identity info and all sub-accounts and return all deposits.
         *
         * Payment: All reserved balances on the account are returned.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a registered
         * identity.
         *
         * Emits `IdentityCleared` if successful.
         */
        clear_identity: TxDescriptor<undefined>;
        /**
         * Request a judgement from a registrar.
         *
         * Payment: At most `max_fee` will be reserved for payment to the registrar if judgement
         * given.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a
         * registered identity.
         *
         * - `reg_index`: The index of the registrar whose judgement is requested.
         * - `max_fee`: The maximum fee that may be paid. This should just be auto-populated as:
         *
         * ```nocompile
         * Self::registrars().get(reg_index).unwrap().fee
         * ```
         *
         * Emits `JudgementRequested` if successful.
         */
        request_judgement: TxDescriptor<Anonymize<I9l2s4klu0831o>>;
        /**
         * Cancel a previous request.
         *
         * Payment: A previously reserved deposit is returned on success.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a
         * registered identity.
         *
         * - `reg_index`: The index of the registrar whose judgement is no longer requested.
         *
         * Emits `JudgementUnrequested` if successful.
         */
        cancel_request: TxDescriptor<Anonymize<I2ctrt5nqb8o7c>>;
        /**
         * Set the fee required for a judgement to be requested from a registrar.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must be the account
         * of the registrar whose index is `index`.
         *
         * - `index`: the index of the registrar whose fee is to be set.
         * - `fee`: the new fee.
         */
        set_fee: TxDescriptor<Anonymize<I711qahikocb1c>>;
        /**
         * Change the account associated with a registrar.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must be the account
         * of the registrar whose index is `index`.
         *
         * - `index`: the index of the registrar whose fee is to be set.
         * - `new`: the new account ID.
         */
        set_account_id: TxDescriptor<Anonymize<I6o1er683vod1j>>;
        /**
         * Set the field information for a registrar.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must be the account
         * of the registrar whose index is `index`.
         *
         * - `index`: the index of the registrar whose fee is to be set.
         * - `fields`: the fields that the registrar concerns themselves with.
         */
        set_fields: TxDescriptor<Anonymize<Id6gojh30v9ib2>>;
        /**
         * Provide a judgement for an account's identity.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must be the account
         * of the registrar whose index is `reg_index`.
         *
         * - `reg_index`: the index of the registrar whose judgement is being made.
         * - `target`: the account whose identity the judgement is upon. This must be an account
         * with a registered identity.
         * - `judgement`: the judgement of the registrar of index `reg_index` about `target`.
         * - `identity`: The hash of the [`IdentityInformationProvider`] for that the judgement is
         * provided.
         *
         * Note: Judgements do not apply to a username.
         *
         * Emits `JudgementGiven` if successful.
         */
        provide_judgement: TxDescriptor<Anonymize<Ibk29mtr51rukj>>;
        /**
         * Remove an account's identity and sub-account information and slash the deposits.
         *
         * Payment: Reserved balances from `set_subs` and `set_identity` are slashed and handled by
         * `Slash`. Verification request deposits are not returned; they should be cancelled
         * manually using `cancel_request`.
         *
         * The dispatch origin for this call must match `T::ForceOrigin`.
         *
         * - `target`: the account whose identity the judgement is upon. This must be an account
         * with a registered identity.
         *
         * Emits `IdentityKilled` if successful.
         */
        kill_identity: TxDescriptor<Anonymize<Id9uqtigc0il3v>>;
        /**
         * Add the given account to the sender's subs.
         *
         * Payment: Balance reserved by a previous `set_subs` call for one sub will be repatriated
         * to the sender.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a registered
         * sub identity of `sub`.
         */
        add_sub: TxDescriptor<Anonymize<Ic68lsi7chpv5k>>;
        /**
         * Alter the associated name of the given sub-account.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a registered
         * sub identity of `sub`.
         */
        rename_sub: TxDescriptor<Anonymize<Ic68lsi7chpv5k>>;
        /**
         * Remove the given account from the sender's subs.
         *
         * Payment: Balance reserved by a previous `set_subs` call for one sub will be repatriated
         * to the sender.
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a registered
         * sub identity of `sub`.
         */
        remove_sub: TxDescriptor<Anonymize<Iek0boln8pgnko>>;
        /**
         * Remove the sender as a sub-account.
         *
         * Payment: Balance reserved by a previous `set_subs` call for one sub will be repatriated
         * to the sender (*not* the original depositor).
         *
         * The dispatch origin for this call must be _Signed_ and the sender must have a registered
         * super-identity.
         *
         * NOTE: This should not normally be used, but is provided in the case that the non-
         * controller of an account is maliciously registered as a sub-account.
         */
        quit_sub: TxDescriptor<undefined>;
        /**
         * Add an `AccountId` with permission to grant usernames with a given `suffix` appended.
         *
         * The authority can grant up to `allocation` usernames. To top up the allocation or
         * change the account used to grant usernames, this call can be used with the updated
         * parameters to overwrite the existing configuration.
         */
        add_username_authority: TxDescriptor<Anonymize<I452bkd71b385t>>;
        /**
         * Remove `authority` from the username authorities.
         */
        remove_username_authority: TxDescriptor<Anonymize<Ie83f0p0ke1f4u>>;
        /**
         * Set the username for `who`. Must be called by a username authority.
         *
         * If `use_allocation` is set, the authority must have a username allocation available to
         * spend. Otherwise, the authority will need to put up a deposit for registering the
         * username.
         *
         * Users can either pre-sign their usernames or
         * accept them later.
         *
         * Usernames must:
         * - Only contain lowercase ASCII characters or digits.
         * - When combined with the suffix of the issuing authority be _less than_ the
         * `MaxUsernameLength`.
         */
        set_username_for: TxDescriptor<Anonymize<Ib9nmpn9ru9aeh>>;
        /**
         * Accept a given username that an `authority` granted. The call must include the full
         * username, as in `username.suffix`. Authorities cannot grant usernames to people, only
         * to regular accounts.
         */
        accept_username: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Remove an expired username approval. The username was approved by an authority but never
         * accepted by the user and must now be beyond its expiration. The call must include the
         * full username, as in `username.suffix`.
         */
        remove_expired_approval: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Set a given username as the primary. The username should include the suffix. Only
         * regular accounts can set their primary username, as people can only have one username,
         * granted through a system allocation.
         */
        set_primary_username: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Start the process of removing a username by placing it in the unbinding usernames map.
         * Once the grace period has passed, the username can be deleted by calling
         * [remove_username](crate::Call::remove_username).
         */
        unbind_username: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Permanently delete a username which has been unbinding for longer than the grace period.
         * Caller is refunded the fee if the username expired and the removal was successful.
         */
        remove_username: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Call with [ForceOrigin](crate::Config::ForceOrigin) privileges which deletes a username
         * and slashes any deposit associated with it.
         */
        kill_username: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Sets the username and on-chain account for a person, along with an empty identity which
         * can only be populated using an oracle through the social credential verification system.
         * The chosen username must be domainless.
         *
         * The sender must sign the alias using the key associated with the provided on-chain
         * account to prove ownership.
         *
         * The dispatch origin for this call must be the contextual alias of the person and the
         * sender must not have already registered their identity and username.
         *
         * Emits `PersonalIdentitySet` if successful.
         */
        set_personal_identity: TxDescriptor<Anonymize<I6b6ng21g2eap6>>;
        /**
         * Open a case for an oracle to judge a social credential of a person.
         *
         * The dispatch origin for this call must be the contextual alias of the person and the
         * sender must have a registered identity.
         *
         * Emits `EvidenceSubmitted` if successful.
         */
        submit_personal_credential_evidence: TxDescriptor<Anonymize<Ia5eqng70q48q6>>;
        /**
         * Callback to enforce the judgement of a social credential. This is to be called only by
         * the oracle that judged the case.
         */
        personal_credential_judged: TxDescriptor<Anonymize<I79nh52dspn15s>>;
        /**
         * Clear a person's identity info. The sender must pay a penalty through the associated
         * alias account for removing the identity.
         *
         * The dispatch origin for this call must be the contextual alias of the person and the
         * sender must have a registered identity.
         *
         * Emits `IdentityPersonalCleared` if successful.
         */
        clear_personal_identity: TxDescriptor<undefined>;
        /**
         * Report a username as invalid/offensive/wrong/anything else.
         *
         * The dispatch origin for this call must be a signed extrinsic.
         *
         * - `username`: The username to be reported.
         */
        report_username: TxDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * Given judgement on a previously reported username either:
         * 1. In case username was found valid:
         * - slashes the amount deposited by the reporter,
         * - does nothing to the identity behind the reported username,
         * 2. In case username was found invalid:
         * - returns the deposited funds to the reporter,
         * - bans the identity behind the reported username.
         * Serves as a callback used upon judgement request to the oracle.
         * Must only be used by the statement oracle.
         */
        reported_username_judged: TxDescriptor<Anonymize<I79nh52dspn15s>>;
    };
    People: {
        /**
         * Dispatch a call under an alias using the `account <-> alias` mapping.
         *
         * This is a call version of the transaction extension `AsPersonalAliasWithAccount`.
         * It is recommended to use the transaction extension instead when suitable.
         */
        under_alias: TxDescriptor<Anonymize<Iejcklm1m5ig5m>>;
        /**
         * This transaction is refunded if successful and no alias was previously set.
         *
         * The call is valid from `call_valid_at` until
         * `call_valid_at + account_setup_time_tolerance`.
         * `account_setup_time_tolerance` is a constant available in the metadata.
         *
         * Parameters:
         * - `account`: The account to set the alias for.
         * - `call_valid_at`: The block number when the call becomes valid.
         */
        set_alias_account: TxDescriptor<Anonymize<I6viutd279aov3>>;
        /**
         * Remove the mapping from a particular alias to its registered account.
         */
        unset_alias_account: TxDescriptor<undefined>;
        /**
         * Recognize a set of people without any additional checks.
         *
         * The people are identified by the provided list of keys and will each be assigned, in
         * order, the next available personal ID.
         */
        force_recognize_personhood: TxDescriptor<Anonymize<I6tuqjmsr5ahcq>>;
        /**
         * Set a personal id account.
         *
         * The account can then be used to sign transactions on behalf of the personal id, and
         * provide replay protection with the nonce.
         *
         * This transaction is refunded if successful and no account was previously set for the
         * personal id.
         *
         * The call is valid from `call_valid_at` until
         * `call_valid_at + account_setup_time_tolerance`.
         * `account_setup_time_tolerance` is a constant available in the metadata.
         *
         * Parameters:
         * - `account`: The account to set the alias for.
         * - `call_valid_at`: The block number when the call becomes valid.
         */
        set_personal_id_account: TxDescriptor<Anonymize<I6viutd279aov3>>;
        /**
         * Unset the personal id account.
         */
        unset_personal_id_account: TxDescriptor<undefined>;
        /**
         * Create the people collection.
         *
         * This call is valid only if the collection doesn't exist yet. Once created,
         * this call cannot be executed again.
         *
         * The collection is created with a fixed configuration:
         * - Owner: Configured via `CollectionOwner` type
         * - Onboarding size: `PEOPLE_ONBOARDING_SIZE` (10)
         * - Mode: `Flexible`
         * - Ring size: `R2e9`
         */
        create_people_collection: TxDescriptor<undefined>;
        /**
         * Remove stale alias <-> account mappings.
         *
         * A mapping is stale when:
         * - its context has been removed from [`Config::AccountContexts`] (governance
         * reconfiguration, ended airdrop etc.), or
         * - its ring has been deleted.
         *
         * Revision mismatches do not render an alias stale. The user can continue
         * transacting via `AsPersonalAliasWithAccountRevised` without having to
         * redo account setup.
         *
         * Typically submitted by the OCW, but the dispatch does not trust
         * the caller. Each alias is re-validated via
         * [`Self::ensure_alias_is_stale`]; those that are not stale are
         * skipped.
         *
         * At most [`MAX_BULK_CLEANUP`] aliases are processed per call.
         *
         * The transaction source must be local or in-block. Thus, external
         * invocations are not permitted.
         */
        clean_up_stale_aliases: TxDescriptor<Anonymize<I8k2cd3v73pgjh>>;
    };
    MobRule: {
        /**
         * Feeless on success (determined only by top three lines).
         */
        vote: TxDescriptor<Anonymize<Ia56ucs8f4gubv>>;
        /**
        
         */
        close_case: TxDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
         * Origin must be `None`. The transaction is validated in `ValidateUnsigned`
         * when the source is local (e.g. from the offchain worker). For external transactions, use
         * `clean_vote_signed`.
         */
        clean_vote: TxDescriptor<Anonymize<Ic01glfot2319>>;
        /**
        
         */
        reap_case: TxDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
        
         */
        intervene: TxDescriptor<Anonymize<Ibi23t489qjaej>>;
        /**
         * A person claims the mob credit associated with a correct vote on a case.
         * The case must be `Done`.
         */
        claim_vote: TxDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
         * A person converts their claimed mob credit into a direct transfer.
         */
        payout_rewards: TxDescriptor<Anonymize<I6a7ia4g91p320>>;
        /**
         * A person claims multiple mob credits associated a correct vote on a case. The
         * case must be `Done`.
         */
        claim_votes: TxDescriptor<Anonymize<I7iebj213rflmh>>;
        /**
        
         */
        start_payout_round: TxDescriptor<undefined>;
        /**
        
         */
        schedule_payout_rounds: TxDescriptor<Anonymize<I1c6o7t4005obp>>;
        /**
        
         */
        remove_payout_schedule: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
        
         */
        claim_credit: TxDescriptor<undefined>;
        /**
        
         */
        clean_points: TxDescriptor<Anonymize<I3sgg3ifcuhgsi>>;
        /**
        
         */
        force_ripen_case: TxDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
        
         */
        touch_case: TxDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
        
         */
        clear_voting_penalty: TxDescriptor<undefined>;
        /**
         * Origin must be signed.
         */
        clean_vote_signed: TxDescriptor<Anonymize<Ic01glfot2319>>;
    };
    ProofOfInk: {
        /**
         * - Declare intention to get a tattoo.
         * - Deposit is taken.
         * - `InkType` may not be `ProceduralDerivative`.
         */
        apply: TxDescriptor<undefined>;
        /**
         * - Open a judicial case to judge the `evidence`.
         * - Calls Judicial/`JudgeStatement(POI_HASH, evidence)`
         * - Needs `SignedExtension` to avoid upfront requirement for fee if `judgements == 0`.
         * - If `judgements > 0`, then an additional fee should be charged into Treasury.
         */
        submit_evidence: TxDescriptor<Anonymize<I2t4r3qi2bbfq5>>;
        /**
         * Is called by the Oracle when the evidence has been judged.
         */
        judged: TxDescriptor<Anonymize<I79nh52dspn15s>>;
        /**
         * - Gets a new `index`
         * - Puts an entry into `People`.
         * - Calls People/`newPerson(index, key)`
         *
         * # Arguments
         * * `key` - The personal identity to register.
         * * `destination` - The account receiving the candidate's referral reward.
         * * `proof_of_ownerhsip` - The signature of predefined prefix `"pop register using"`
         * concatenated with the sender account id.
         */
        register_referred: TxDescriptor<Anonymize<I1kb7l7cim8dam>>;
        /**
         * - Gets a new `index`
         * - Puts an entry into `People`.
         * - Calls People/`newPerson(index, key)`
         *
         * # Arguments
         * * `key` - The personal identity to register.
         * * `destination` - The account receiving rewards.
         * * `proof_of_ownerhsip` - The signature of predefined prefix `"pop register using"`
         * concatenated with the sender account id.
         *
         * # Warning:
         *
         * This call can pay two rewards to the same account for non-referred candidates.
         * The app is responsible for any additional privacy handling after transfer.
         */
        register_non_referred: TxDescriptor<Anonymize<I1kb7l7cim8dam>>;
        /**
        
         */
        reroll: TxDescriptor<undefined>;
        /**
         * Commit to a design and authorize the storage for (possibly just initial) evidence.
         *
         * If a specific personal identity is required, then this can be placed in `require_id`.
         * This can be any unused/unreserved personal identity no greater than the `NextId`
         * counter.
         */
        commit: TxDescriptor<Anonymize<I9cpejm8q1n41i>>;
        /**
        
         */
        allocate_full: TxDescriptor<undefined>;
        /**
         * Once a timeout passes, removes a candidate who is selected but not yet proven.
         * If the candidate was referred then referral is bad, if candidate applied with deposit,
         * deposit is slashed.
         */
        timeout: TxDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * Remove a candidate who has not yet committed.
         */
        flakeout: TxDescriptor<undefined>;
        /**
         * Utilize a referral signature.
         *
         * The payload to be signed by the referrer using their registered key pair is the encoded
         * bytes of the account ID of the candidate.
         */
        apply_with_signature: TxDescriptor<Anonymize<I48li8do1boqsk>>;
        /**
         * Apply to the Proof-of-Ink process with an invitation.
         *
         * The payload to be signed by the inviter using their registered key pair is the encoded
         * bytes of the account ID of the candidate.
         */
        apply_with_invitation: TxDescriptor<Anonymize<I8cj8rnq5f1nol>>;
        /**
         * Add a design family. Must have privileged access to do this.
         */
        add_design_family: TxDescriptor<Anonymize<Idnsos6tvi9tt6>>;
        /**
         * Add a referral ticket associated with a person.
         *
         * Only one referral ticket may be active at any given time for one person. Calling this
         * extrinsic while a valid ticket is set will overwrite the existing ticket.
         *
         * If any pending referral rewards are present, they need to be registered first.
         */
        set_referral_ticket: TxDescriptor<Anonymize<I95p7g3tmk59ap>>;
        /**
         * Cancel a referral ticket associated with a person.
         */
        cancel_referral_ticket: TxDescriptor<Anonymize<I95p7g3tmk59ap>>;
        /**
        
         */
        register_successful_referral_reward: TxDescriptor<Anonymize<I6a7ia4g91p320>>;
        /**
         * Grants invites to an account so they can distribute them.
         *
         * The origin must be `InvitationsOrigin.
         *
         * - `account`: The account to give invites to.
         * - `count`: The number of invites to give.
         */
        grant_invites: TxDescriptor<Anonymize<Ibl1gaa0rn2c67>>;
        /**
         * Remove all invites given to an account.
         *
         * The origin must be `InvitationsOrigin`.
         *
         * - `account`: The account to remove all invites from.
         * - `limit`: The maximum number of pending invites to remove.
         */
        remove_available_and_pending_invites: TxDescriptor<Anonymize<Id8vsjdockv55e>>;
        /**
         * Invite an account.
         *
         * The origin must be signed by an account and have some invites left.
         *
         * - `ticket`: The invite ticket to set.
         */
        set_invite_ticket: TxDescriptor<Anonymize<I95p7g3tmk59ap>>;
        /**
         * Cancel an invitation.
         *
         * The origin must be signed by the account that owns the ticket to cancel.
         *
         * - `ticket`: The invite ticket to cancel.
         */
        cancel_invite_ticket: TxDescriptor<Anonymize<I95p7g3tmk59ap>>;
        /**
         * Set the configuration record. Must have privileged access to do this.
         */
        set_configuration: TxDescriptor<Anonymize<I4s48t49obgv40>>;
        /**
         * Set the values of the reimbursement awarded to referred candidates as well as their
         * referrers, along with the number of reimbursements for each value. These values are
         * stored in
         * reverse order of their priority, so the last value in the list will be the first one
         * to be used by the reimbursement system. The length of the two lists must be equal.
         *
         * WARNING!
         *
         * After the number of reimbursements is exhausted for a value in the list, the pallet
         * starts using the next value immediately for future transfers.
         */
        set_reimbursement_values: TxDescriptor<Anonymize<I1b497vgt5ie3v>>;
    };
    Game: {
        /**
         * Sign up for the game using an account and an invite.
         *
         * This is for new players or archived players, other players should use
         * [`Pallet::sign_up_with_account`] for free.
         *
         * A game must be ongoing and in its registration phase.
         *
         * `airdrop` optionally enters the player into this game's airdrop draw. Pass `None` to
         * skip it. When `Some`, it is the player's VRF, which both seeds their draw slot and
         * proves their identity path: the alias variant if the player is recognized (pallet-score
         * `recognition` is `Recognized` or `ExternallyRecognized`), otherwise the account variant.
         * See the documentation of [`AirdropVrf`] for more details.
         *
         * The origin must be a signed by an account and use the `GameAsInvited` extension.
         */
        sign_up_with_invite: TxDescriptor<Anonymize<I5vj4b1eolhu8i>>;
        /**
         * Sign up for the game using an account.
         *
         * If the player is new or archived, then a deposit will be taken from the signer.
         * Otherwise the call is free.
         *
         * A game must be ongoing and in its registration phase.
         *
         * `airdrop` optionally enters the player into this game's airdrop draw. Pass `None` to
         * skip it. When `Some`, it is the player's VRF, which both seeds their draw slot and
         * proves their identity path: the alias variant if the player is recognized (pallet-score
         * `recognition` is `Recognized` or `ExternallyRecognized`), otherwise the account variant.
         * See the documentation of [`AirdropVrf`] for more details.
         *
         * The origin must be signed by an account, or, be signed by an account and use
         * `ScoreAsParticipant` extension.
         */
        sign_up_with_account: TxDescriptor<Anonymize<I5vj4b1eolhu8i>>;
        /**
         * Sign up for the game.
         *
         * If a player is already recognized by another DIM, they can sign using their alias and
         * don't need any deposit or invite to prove their initial credibility.
         * On top of this their score is never going below personhood threshold and the player will
         * never get archived.
         *
         * A game must be ongoing and in its registration phase.
         *
         * The origin must be a personal alias.
         *
         * Parameters:
         * - `statement_account`: the account id to use to interact with the statement store during
         * the game.
         * - `sig`: the proof of ownership of the account `statement_account` by an alias, it is
         * the signature of the message `"pop:game:stmt_account_for_alias:"` concatenated to the
         * alias, and then hashed with `blake2_256` (blake2 256bit output). The base of the
         * message can be found in the constant: `proof_of_ownership_msg_base`.
         * - `airdrop`: optionally enters the player into this game's airdrop draw, Pass `None` to
         * skip it. When `Some`, it is the player's VRF, which both seeds their draw slot and
         * proves their identity path: the alias VRF must be used for alias-based players given
         * they are recognized in pallet-score participant information. See the documentation of
         * `AirdropVrf` for more details.
         */
        sign_up_with_alias: TxDescriptor<Anonymize<If3trlhj4nhm3u>>;
        /**
         * After the game, send the full report.
         *
         * The game must be ongoing and in its reporting phase.
         *
         * The origin must be an alias, or signed by an account, or signed by an account and use
         * `ScoreAsParticipant` extension.
         *
         * After the votes from the report are counted, the reporter and each of the reported
         * players whose attendance can now be determined are processed early. This lets the
         * game skip the player-process phase entirely when every player has been processed by
         * the end of reporting.
         */
        report: TxDescriptor<Anonymize<I8dtsqbl6shss6>>;
        /**
         * Offboard a player from the game.
         *
         * The origin must be an alias, or signed by an account, or signed by an account and use
         * `ScoreAsParticipant` extension.
         *
         * There must be no game or the existing game must be in registration phase and the player
         * must have not signed up for the game.
         */
        offboard: TxDescriptor<undefined>;
        /**
         * Kickout a kickable player that is not playing after `NonPlayingKickoutTime`.
         *
         * The origin must be signed by an account.
         *
         * - `player`: The player to kickout. It must be archived and kickable with
         * `archived_since` older than `NonPlayingKickoutTime`.
         */
        kickout: TxDescriptor<Anonymize<Ifpsbvfoe7erus>>;
        /**
         * Grant some invites to an account so they can distribute them.
         *
         * The origin must be `InviteIssuer`.
         *
         * - `account`: The account to grant invites to.
         * - `count`: The number of invites to grant.
         */
        grant_invites: TxDescriptor<Anonymize<Ibl1gaa0rn2c67>>;
        /**
         * Clear all invites given to an account.
         *
         * The origin must be `InviteIssuer`.
         *
         * - `account`: The account to remove all invites from.
         * - `limit`: The maximum number of pending invites to remove.
         */
        remove_available_and_pending_invites: TxDescriptor<Anonymize<Id8vsjdockv55e>>;
        /**
         * Invite an account.
         *
         * The origin must be signed by an account and have some invites left.
         *
         * - `ticket`: The invite ticket to set.
         */
        set_invite_ticket: TxDescriptor<Anonymize<I95p7g3tmk59ap>>;
        /**
         * Cancel an invite.
         *
         * The origin must be signed by the account that owns the ticket to cancel.
         *
         * - `ticket`: The invite ticket to cancel.
         */
        cancel_invite_ticket: TxDescriptor<Anonymize<I95p7g3tmk59ap>>;
        /**
         * Schedules new games according to provided schedules.
         * Schedules must be in chronological order, and after the ongoing game (if there is any).
         */
        schedule_games: TxDescriptor<Anonymize<I4mfip5i7mpjk2>>;
        /**
        
         */
        remove_scheduled_game: TxDescriptor<Anonymize<Ic9lb0ksm6bqp9>>;
        /**
         * Update the configured play deposit amount for future account signups.
         */
        set_play_deposit: TxDescriptor<Anonymize<I3qt1hgg4djhgb>>;
        /**
         * Claim a prize from the airdrop event scheduled for `game_index`.
         *
         * Eligibility requires 2 conditions on the claimant to be recognized and have attended the
         * game. In more details:
         * * to be either recognized in pallet-score (`recognition.is_recognized()`) or to have
         * reached the personhood score (`reached_personhood`),
         * * AND for `game_index` to match the participant's `last_attended_game` — i.e. the most
         * recent game the claimant actually attended must be exactly the game the airdrop is
         * tied to. Subsequent game attendance overrides this information so the claim must be
         * made before attending another game.
         *
         * Claims against a cancelled game are rejected.
         */
        claim_airdrop: TxDescriptor<Anonymize<I2254l15dgaup8>>;
        /**
         * Force start the shuffle before its normal start time.
         *
         * This action can only be performed by the root origin and is only meant for testing.
         */
        testnet_force_start_shuffle: TxDescriptor<undefined>;
        /**
         * Force end a game's reporting phase before its normal end time.
         *
         * This action can only be performed by the root origin and is only meant for testing.
         */
        testnet_force_end_reporting: TxDescriptor<undefined>;
        /**
         * Override the game phase durations.
         *
         * Restricted to [`Config::ManagerOrigin`] (or root). Until reset, all future
         * game schedules use these phases instead of [`Config::DefaultPhaseDurations`].
         * To revert, the manager re-issues the call with the desired explicit
         * values — there is no separate clear extrinsic.
         *
         * Only callable while no game exists or the current game is still in its
         * Registration phase; otherwise fails with [`Error::InvalidGameState`]. This
         * prevents changing phase durations once players have committed to a game
         * whose timing is already locked in.
         */
        set_game_phases: TxDescriptor<Anonymize<I7rcbn8l002fcc>>;
        /**
         * Kill the current game, regardless of which phase it is in.
         *
         * Restricted to [`Config::ManagerOrigin`] (or root). Intended as an emergency
         * recovery lever when a game is stuck or its state has been corrupted.
         */
        kill_current_game: TxDescriptor<undefined>;
    };
    Score: {
        /**
         * Schedule payout rounds.
         *
         * Called from `ManagerOrigin` or root.
         */
        schedule_payout_rounds: TxDescriptor<Anonymize<Icpk5dvoekngbe>>;
        /**
         * Remove a scheduled payout round.
         *
         * Called from `ManagerOrigin` or root.
         */
        remove_payout_schedule: TxDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
         * Start a new round.
         *
         * This is valid if the current round is finished, or if the current round doesn't have
         * planning and a schedule exists to plan it.
         *
         * This is a task, and can be called from anybody.
         */
        transition_round: TxDescriptor<Anonymize<Iepoo00jurbs3c>>;
        /**
         * Operate some round paying out.
         *
         * Drains round's participants, up to a limit. For each participant, add the calculated
         * reward (`base_reward + remainder_portion`) to their `credit` balance.
         *
         * Then, moves funds on the pot account from Payout to Credit, so they are owed to specific
         * participants rather than the round pool.
         *
         * Finally, release the leftover from the Payout hold back to the pot's free balance
         * (funds are recycled).
         *
         * This is a task, and can be called from anybody.
         *
         * * round_index: The index of the round to operate.
         * * limit: The maximum number of participants to operate in this call.
         */
        operate_payout_round: TxDescriptor<Anonymize<I6vn2ukq88hmrf>>;
        /**
         * Cash out half of the score, rounded up. Converts the score into points for the current
         * payout round. Caller must have never reached personhood since onboarding.
         *
         * It can be called once per game session (era).
         *
         * Origin must be signed or participant (signed extrinsic using ScoreAsParticipant
         * transaction extension)
         *
         * Alias origin is not allowed as they can't cash out.
         */
        cash_out: TxDescriptor<undefined>;
        /**
         * Redeem full accumulated credit, transferring it to the provided destination account.
         *
         * Credit is converted from points during payout processing.
         *
         * Origin must be a person alias, a signed account or a participant (signed extrinsic
         * using ScoreAsParticipant transaction extension).
         */
        redeem_credit: TxDescriptor<Anonymize<I6a7ia4g91p320>>;
        /**
         * Register as a person, or resume personhood after suspension.
         *
         * Requires score >= personhood threshold (or having previously reached it).
         *
         * If the participant was previously recognised and is now suspended, they must not provide
         * a key. The existing key is reused.
         *
         * If the participant was never recognised, they must provide a key and a proof of
         * ownership (`key` parameter): a signature over `"pop register using" ||
         * sender_account_id`.
         *
         * Origin must be signed or a participant (signed extrinsic using ScoreAsParticipant
         * transaction extension).
         */
        register: TxDescriptor<Anonymize<Iea8e3kkhkfkdo>>;
        /**
         * Set the absence grace schedule.
         *
         * Every tier must satisfy: `0 <= window <= 8` and `allowed_misses < window`.
         * `allowed_misses = 0` disables grace entirely (any absence immediately
         * suspends).
         *
         * Tiers must be provided in ascending order of `population_size_threshold`.
         *
         * An empty schedule disables the grace period entirely (immediate
         * suspension on any missed game). The new ratio takes effect at the start
         * of the next report session when `update_thresholds()` recalculates
         * `AbsenceGraceRatio`.
         *
         * Called from `ManagerOrigin` or root.
         */
        set_absence_grace_schedule: TxDescriptor<Anonymize<I2onutgm9avq0n>>;
        /**
         * Set the personhood-threshold schedule.
         *
         * Tiers must be:
         * - non-empty,
         * - sorted ascending by `population_size_threshold`,
         * - capped by a final tier with `population_size_threshold == u32::MAX`,
         * - per-tier: `0 < score_threshold <= MAX_PERSONHOOD_THRESHOLD` (= 21),
         * - have non-decreasing `score_threshold` across tiers.
         *
         * The new curve takes effect at the start of the next report session
         * when `update_thresholds()` recalculates `PersonhoodThreshold`.
         *
         * Already-recognized participants are NOT retroactively suspended:
         * the new bar only gates future score evaluations in `set_attendance`.
         *
         * Called from `ManagerOrigin` or root.
         */
        set_personhood_threshold_schedule: TxDescriptor<Anonymize<I4270jaa2l0rr6>>;
    };
    DummyDim: {
        /**
         * Reserve a number of personal IDs.
         */
        reserve_ids: TxDescriptor<Anonymize<Iafscmv8tjf0ou>>;
        /**
         * Renew a personal ID. The ID must not be in use.
         */
        renew_id_reservation: TxDescriptor<Anonymize<I4ov6e94l79mbg>>;
        /**
         * Cancel a personal ID reservation.
         */
        cancel_id_reservation: TxDescriptor<Anonymize<I4ov6e94l79mbg>>;
        /**
         * Grant personhood for a list of candidates that have reserved personal IDs.
         */
        recognize_personhood: TxDescriptor<Anonymize<Ib5ou59k6na5qv>>;
        /**
         * Suspend the personhood of a list of recognized people. The people must not currently be
         * suspended.
         */
        suspend_personhood: TxDescriptor<Anonymize<I7qh4t1qniuepu>>;
        /**
         * Resume someone's personhood. The person must currently be suspended.
         */
        resume_personhood: TxDescriptor<Anonymize<I4ov6e94l79mbg>>;
        /**
         * Start a mutation session in the underlying `People` interface. This call does not check
         * whether a mutation session is already ongoing and can start new sessions.
         */
        start_mutation_session: TxDescriptor<undefined>;
        /**
         * End a mutation session in the underlying `People` interface. This call can end multiple
         * mutation sessions, even ones not started by this pallet.
         *
         * This call will fail if no mutation session is ongoing.
         */
        end_mutation_session: TxDescriptor<undefined>;
    };
    PeopleLite: {
        /**
         * Grant some attestation allowance to an account so they can attest people.
         *
         * The origin must be `AttestationAllowanceManager`.
         *
         * - `account`: The account to grant attestations to.
         * - `count`: The number of attestations to grant.
         */
        increase_attestation_allowance: TxDescriptor<Anonymize<Ibl1gaa0rn2c67>>;
        /**
         * Clear all attestation allowance for an account.
         *
         * The origin must be `AttestationAllowanceManager`.
         *
         * - `account`: The account to remove all attestations from.
         */
        clear_attestation_allowance: TxDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * Attest an account.
         *
         * The origin must be signed by an account and have some attestation allowance left.
         *
         * The authority will have to get two signatures from the user:
         * - one created using their account key attesting to the ownership of the `candidate`
         * account;
         * - one created using their ring-vrf key attesting to the ownership of the `ring_vrf_key`
         * key.
         *
         * The message to be signed by both keys from which the signatures are generated is created
         * by concatenating the bytes "pop:people-lite:register using" with the encoded bytes of
         * the user's account (`candidate`), and the encoded bytes of the ring VRF key
         * (`ring_vrf_key`).
         *
         * On success, this call:
         * - stores lite registration data in `LitePeople`,
         * - adds the user's ring VRF key to the lite member collection.
         *
         * The lite member collection must already have been initialized by `on_poll`.
         *
         * - `candidate`: The candidate to be recognized as a lite person.
         * - `candidate_signature`: The signature, provided by the candidate, to allow the attester
         * to complete the registration process on their behalf.
         * - `ring_vrf_key`: The ring VRF key to be associated with the lite person.
         * - `ring_vrf_key_signature`: The ring VRF signature, provided by the candidate, to allow
         * the attester to complete the registration process. This also prove the ownership of
         * the ring VRF key by the candidate.
         * - consumer_registration: Optional parameter which can contain the necessary information
         * to forward a consumer registration request to the `LiteConsumerRegistrar` service. If
         * present, it also contains a signature created by the user in order to validate the
         * intent. More information on the signing payload generation available in
         * [types::LiteConsumerRegistrationParams::signing_payload].
         */
        attest: TxDescriptor<Anonymize<Iddfuva7fle38r>>;
        /**
        
         */
        dispatch_as_signer: TxDescriptor<Anonymize<Iejcklm1m5ig5m>>;
        /**
         * Set the account associated with a lite alias.
         *
         * The call is valid from `valid_at_block` until
         * `valid_at_block + account_setup_block_tolerance`.
         */
        set_alias_account: TxDescriptor<Anonymize<Iefam38o91ona9>>;
        /**
        
         */
        unset_alias_account: TxDescriptor<undefined>;
    };
    Resources: {
        /**
         * Register a lite person as a consumer.
         */
        register_lite_person: TxDescriptor<Anonymize<Ifd8dbgpm7srdt>>;
        /**
         * Register a proven person as a consumer.
         *
         * The person must link a previously recognized lite identity, which will be upgraded to a
         * full person consumer. In order to prove they hold the lite identity they want to link,
         * users must provide a `lite_identity_proof` signature, created by signing the alias bytes
         * using their lite consumer account.
         *
         * The consumer can choose if they want to have a new username or use an existing
         * reservation made in the name of the lite consumer who will be linked.
         */
        register_person: TxDescriptor<Anonymize<Ifbug00rch8etj>>;
        /**
         * Update a person's authorization by ensuring they can still authenticate as people.
         *
         * This call must be performed at least `MinPersonAuthUpdateInterval` seconds after the
         * last update in order to prevent spam.
         */
        touch_person_authorization: TxDescriptor<undefined>;
        /**
         * Remove an expired entry from a username reservation queue. The target entry is
         * identified by `account` and can be at any position in the queue.
         * Each call removes exactly one entry, so it must be called repeatedly to
         * clear multiple expired reservations.
         *
         * This is a permissionless call; the origin must be authorized. The `account`
         * parameter is also used for transaction pool deduplication, allowing parallel
         * submissions that target different expired entries in the same queue.
         */
        remove_expired_username_reservation: TxDescriptor<Anonymize<I28tfrqrmts741>>;
        /**
         * Update the communication identifier key of a consumer.
         *
         * The origin must be the account registered for that consumer, regardless of their
         * credibility.
         */
        update_identifier_key: TxDescriptor<Anonymize<Ievhkup0angt51>>;
        /**
         * Set the duration for which a username reservation is valid, in seconds.
         *
         * The origin must be root.
         */
        set_username_reservation_duration: TxDescriptor<Anonymize<I1i6t85s8phv1c>>;
        /**
         * Demote a full person to a lite person after their authorization has expired.
         *
         * This is a permissionless call; the origin must be authorized.
         */
        demote_auth_expired: TxDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * Associate a statement account with a friend request context sequence.
         *
         * The associated account can submit statements while this friend request registration is
         * active.
         * The origin must be `Origin::FriendRequestAlias`, created by the `AsResources`
         * (`RegisterFriendRequestWithProof(..)`) transaction extension after proof validation.
         * On success, increases statement allowance and stores registration state
         * `{account_id, reference}`.
         *
         * Parameters:
         * * `reference`: friend request period/sequence pair.
         * - `reference.period` must be in the accepted period window: `[period(now -
         * FriendRequestGraceWindow), period(now)]`.
         * - `reference.seq` must be in `0..=FriendRequestSlotsPerPeriod`.
         * * `account_id`: statement account to authorize. Must not already be used by another
         * friend request registration.
         */
        set_friend_request_statement_account_for_sequence: TxDescriptor<Anonymize<Id77vvrgqmru2o>>;
        /**
         * Clear a stale friend request registration and revoke its statement allowance.
         *
         * This is a permissionless call; the origin must be authorized.
         * Succeeds only when the registration's period-derived expiry has elapsed.
         * On success, removes friend request registration state and decreases statement allowance.
         *
         * Parameters:
         * * `account`: statement account previously associated with a friend request registration.
         * * `seq`: friend request sequence to clear. Must match stored registration sequence and
         * be in `0..=FriendRequestSlotsPerPeriod`.
         */
        clear_expired_friend_request_sequence: TxDescriptor<Anonymize<I5os021n9mtdcr>>;
        /**
         * Claim an anonymous statement store allowance for a target account.
         *
         * The origin must be `Origin::StmtStoreAlias`, produced by the `AsResources`
         * (`RegisterStatementStoreAllowance(..)`) transaction extension after proof validation.
         * On success, increases the statement allowance for `target_account` and stores the
         * mapping in `StatementStoreAllowances`.
         *
         * Parameters:
         * * `period`: day number since Unix epoch. Must be in the accepted period window.
         * * `seq`: slot number within the period, bounded by the collection-specific limit.
         * * `target_account`: statement account to authorize.
         */
        set_statement_store_account: TxDescriptor<Anonymize<I66tl4phltl6bg>>;
        /**
         * Remove expired statement store allowances for a past period.
         *
         * This is a permissionless call; the origin must be authorized.
         * Removes up to `StmtStoreCleanupLimit` entries from `StatementStoreAllowances` for
         * the given `period`, decreasing the statement allowance for each removed account.
         */
        clear_expired_stmt_store_allowances: TxDescriptor<Anonymize<I4t3pgt4ilgpf6>>;
        /**
         * Claim long-term storage on a remote chain using an anonymous membership proof.
         *
         * The origin must be `Origin::LongTermStorageClaim(alias, collection)`, created by the
         * `AsResources` (`ClaimLongTermStorage(..)`) transaction extension after ring-VRF proof
         * validation.
         *
         * Parameters:
         * * `period`: the claiming period. Must be the current period or the previous one if
         * within the grace window.
         * * `counter`: the claim counter within the period. Must be less than
         * `LongTermStorageClaimsPerPeriod`. Each counter produces a distinct alias.
         * * `account_id`: the account to authorize for storage on the remote chain.
         */
        claim_long_term_storage: TxDescriptor<Anonymize<Ifles5ioatcuip>>;
        /**
         * Clear spent long-term storage aliases for an expired period.
         *
         * This is a permissionless call authorized via the `authorize` attribute. It can be
         * called by anyone once a period has fully expired (past the grace window).
         *
         * Parameters:
         * * `period`: the expired period to clear aliases for.
         * * `limit`: the maximum number of entries to remove in this call.
         */
        clear_expired_long_term_storage_aliases: TxDescriptor<Anonymize<Id2jcn0qee7h6f>>;
    };
    ChunksManager: {
        /**
         * Adds a new page of chunks.
         *
         * The hash of the chunks must match the hash stored on-chain in `ChunkPageHashes`.
         * The call will fail if the page already exists on-chain.
         */
        add_chunks: TxDescriptor<Anonymize<Ijgrep2ca50rk>>;
        /**
         * Sets the expected hashes for chunk pages for a given ring exponent.
         *
         * Allows setting the expected hashes that chunks must match when added via
         * `add_chunks`.
         *
         * The origin must be `ManagerOrigin` or root.
         */
        set_chunk_page_hashes: TxDescriptor<Anonymize<Iasnonvq8v9o5g>>;
    };
    Members: {
        /**
         * Merge the members in two rings into a single, new ring. In order for the rings to be
         * eligible for merging, they must be below 1/2 of max capacity, have no pending
         * suspensions and not be the top ring used for onboarding.
         */
        merge_rings: TxDescriptor<Anonymize<I6mk90q9np5nf3>>;
        /**
         * Force set the onboarding size for a collection. This call requires root privileges.
         */
        set_onboarding_size: TxDescriptor<Anonymize<Ichkkipipv6vbf>>;
        /**
         * Allow a member waiting in the onboarding queue to include themselves into a ring
         * after enough time has passed. This bypasses the normal cohort-based onboarding size
         * requirement.
         *
         * This call must be dispatched with a `SelfInclude` origin, authenticated by the
         * `AsMember` transaction extension. The rings must be in append-only mode.
         *
         * The `call_valid_at` parameter dictates the time window in which this transaction is
         * valid and represents the timestamp (in seconds since the UNIX epoch) when this call
         * becomes valid.
         */
        self_include: TxDescriptor<Anonymize<Ie0n67dnlcbpcf>>;
        /**
         * Build a ring root for a specific ring in a collection.
         *
         * Submitted by the OCW with a `to_include` snapshot from
         * [`Self::should_build_ring`]. Leftovers from later onboarding are picked up
         * on the next OCW tick, or by the member via [`Self::self_include`] when
         * cohort gating stalls onboarding.
         */
        build_ring_authorized: TxDescriptor<Anonymize<I1bv5scdc27nbb>>;
        /**
         * Onboard members from the onboarding queue for a specific collection.
         *
         * Submitted by the offchain worker.
         */
        onboard_members_authorized: TxDescriptor<Anonymize<I12c2udla9t40g>>;
        /**
         * Merge the top two onboarding queue pages for a specific collection.
         *
         * Submitted by the offchain worker.
         */
        merge_queue_pages_authorized: TxDescriptor<Anonymize<I4eperb3q65q14>>;
        /**
         * Remove suspended keys from a specific ring in a collection.
         *
         * Submitted by the offchain worker.
         */
        remove_suspended_keys_authorized: TxDescriptor<Anonymize<Idpufnltgsuodp>>;
        /**
         * Delete a page for a specific ring in a collection.
         *
         * Submitted by the offchain worker.
         */
        delete_ring_page_authorized: TxDescriptor<Anonymize<I8lare4sf457ul>>;
        /**
         * Enqueue a ring for deletion as part of collection deletion.
         *
         * Archives the ring root, notifies subscribers, removes ring metadata, and
         * enqueues ring pages into `RingDeletionQueue` for processing by
         * `delete_ring_page_authorized`.
         *
         * Submitted by the offchain worker.
         */
        enqueue_ring_deletion_authorized: TxDescriptor<Anonymize<Idpufnltgsuodp>>;
        /**
         * Delete an onboarding queue page as part of collection deletion.
         *
         * Removes all `Members` entries for the members in the page, then removes
         * the page itself. Can only proceed when all rings and ring pages have been
         * fully deleted.
         *
         * Submitted by the offchain worker.
         */
        delete_onboarding_queue_page_authorized: TxDescriptor<Anonymize<I2gt0vglt3agsj>>;
        /**
         * Finalize collection deletion.
         *
         * Removes all remaining per-collection storage and the owner's identifier
         * reference. Can only proceed when all rings, ring pages, and onboarding
         * queue pages have been fully deleted.
         *
         * Submitted by the offchain worker.
         */
        finalize_collection_deletion_authorized: TxDescriptor<Anonymize<Idjiu7vp8ovdab>>;
        /**
         * Mark a ring as stale so the offchain worker will rebuild it.
         *
         * Anyone can submit this transaction if the ring has members that are not
         * yet included in the root (`total > included`) and the ring is not already
         * marked stale. This is a recovery mechanism in case the `StaleRings` entry
         * was lost or never inserted.
         */
        mark_ring_stale_authorized: TxDescriptor<Anonymize<Idpufnltgsuodp>>;
        /**
         * Clean up expired old ring roots.
         *
         * Removes up to `limit` old ring roots for the given ring in the given
         * collection.
         *
         * The transaction source must be `Local` or `InBlock`.
         *
         * This is a maintenance call. Submitted by the offchain worker.
         */
        clean_up_old_roots_authorized: TxDescriptor<Anonymize<I4maqh2jefgv7u>>;
    };
    Coinage: {
        /**
         * Split a coin into multiple coins.
         *
         * The origin must be a [Origin::Coin], which can be obtained from the transaction
         * extension [AsCoinage].
         *
         * The call is free and ages the resulting coins by one.
         *
         * The `split_into` parameter contains a vector of pairs, each pair containing a coin
         * value and a list of destination account ids. For each pair, a new coin with the given
         * value is created for each destination account id.
         *
         * Validity requirements:
         * (an invalid transaction won't be included in a block, the coin is not consumed)
         * * The coin's age must be less than [Config::MaximumAge].
         * * The coin value must be within the bounds defined by [Config::MinimumExponent] and
         * [Config::MaximumExponent].
         * * The total value of the new coins must equal the value of the origin coin.
         * * The number of outputs must not exceed [Config::MaxSplitOutputs].
         * * The age of the new coins is set to the age of the origin coin plus one.
         * * Each destination account must not already have a coin.
         */
        split: TxDescriptor<Anonymize<Ibv24s7lkcbv1r>>;
        /**
         * Transfer a coin to another account.
         *
         * The origin must be a [Origin::Coin], which can be obtained from the transaction
         * extension [AsCoinage].
         *
         * The call is free and ages the resulting coin by one.
         *
         * Validity requirements:
         * (an invalid transaction won't be included in a block, the coin is not consumed)
         * * The destination account must not already have a coin.
         * * The coin's age must be less than [Config::MaximumAge].
         */
        transfer: TxDescriptor<Anonymize<Iadkk9nq2cqqve>>;
        /**
         * Load coin into a recycler.
         *
         * The origin must be a [Origin::Coin], which can be obtained from the transaction
         * extension [AsCoinage].
         *
         * The call is free.
         *
         * The `member_key` parameter is the member key to be included in the recycler, and whose
         * alias is used to unload from the recycler.
         *
         * Validity requirements:
         * (an invalid transaction won't be included in a block, the coin is not consumed)
         * * The `member_key` must not already be used in another recycler.
         * * The `member_key` must be valid (i.e. well formed).
         * * The `proof_of_ownership` must be a valid signature of the coin's account id by the
         * `member_key`.
         * * The recycler collection for the coin's value must already exist
         */
        load_recycler_with_coin: TxDescriptor<Anonymize<I1b55a83kk37g4>>;
        /**
         * Load external asset into a recycler.
         *
         * The origin must be a signed origin.
         *
         * The transaction fee is refunded.
         *
         * The `preservation` parameter indicates how the asset transfer should preserve the
         * signer's account.
         *
         * The `value` parameter indicates the coin value to be loaded into the recycler.
         * The equivalent amount of the underlying asset is transferred from the signer to
         * the pallet account.
         *
         * The `member_key` parameter is the member key to be included in the recycler, and whose
         * alias is used to unload from the recycler.
         *
         * The `proof_of_ownership` parameter is the signature of the signer's account id by the
         * `member_key`.
         *
         * Requirements:
         * * The `member_key` must not already be used in another recycler.
         * * The `member_key` must be valid (i.e. well formed).
         * * The `value` must be within the bounds defined by [Config::MinimumExponent] and
         * [Config::MaximumExponent].
         * * The signer must have enough balance of the underlying asset to cover the equivalent
         * amount for the given coin value.
         * * The `proof_of_ownership` must be a valid signature of the signer's account id by the
         * `member_key`.
         */
        load_recycler_with_external_asset: TxDescriptor<Anonymize<Icdnv1iut1hln7>>;
        /**
         * Load external asset into a recycler (infallible, validated unpaid variant).
         *
         * The origin must be [Origin::InfallibleUnpaidSigned], which can be obtained from the
         * transaction extension variant [AsCoinage::InfallibleUnpaidSigned].
         *
         * The transaction extension validation phase must ensure:
         * - The `member_key` is valid and not already used in another recycler.
         * - The `proof_of_ownership` is a valid signature of the signer's account id by the
         * `member_key`.
         * - The `value` is within the bounds defined by [Config::MinimumExponent] and
         * [Config::MaximumExponent], and can be losslessly converted to an asset amount.
         * - The signer has enough balance of the underlying asset to cover the equivalent amount
         * for the given coin value (respecting `preservation`).
         * - The nonce is valid for replay protection.
         * - The recycler collection for `value` already exists.
         *
         * The call is free.
         */
        load_recycler_with_external_asset_unpaid: TxDescriptor<Anonymize<Icdnv1iut1hln7>>;
        /**
         * Batched variant of [`Self::load_recycler_with_external_asset_unpaid`].
         *
         * The origin must be [Origin::InfallibleUnpaidSigned], which can be obtained from the
         * transaction extension variant [AsCoinage::InfallibleUnpaidSigned]. The extension
         * validates each inner item and additionally checks within-batch member-key uniqueness
         * and that the signer's balance covers the sum of all inner asset amounts.
         *
         * This call dispatches each inner load by re-running the same checks the extension
         * just performed (see [`RecyclerManager::load`]). The redundancy matches the defensive
         * pattern used by [`Self::load_recycler_with_external_asset_unpaid`]: a dispatch path
         * that fails any of these checks is a logic bug in the extension, not a user error.
         *
         * The call is free.
         */
        load_recycler_with_external_asset_unpaid_batch: TxDescriptor<Anonymize<I8a919tojdi2qf>>;
        /**
         * Unload a recycler to mint a new coin.
         *
         * The origin must be a [Origin::UnloadToken] with `fee: UnloadFee::Prepaid`, which can be
         * obtained from the transaction extension [AsCoinage] using `AsUnloadTokenPeople`,
         * `AsUnloadTokenLitePeople`, or `AsUnloadTokenPaid` variants.
         *
         * This function allows a user to prove they own one or more coins in a recycler ring
         * without revealing which specific coins they own. It consolidates one or multiple inputs
         * into a single output coin.
         *
         * Parameters:
         * * `aliases`: the list of aliases corresponding to the member keys included in the
         * recycler. The proofs for these aliases are contained in the origin.
         * * `value` and `index`: identifies the recycler being unloaded.
         * * `_revision`: the recycler revision used for the alias_proofs.
         * * `to`: the destination account for the new coin.
         *
         * Requirements:
         * * The origin must be [Origin::UnloadToken] with `fee: UnloadFee::Prepaid`.
         * * The recycler identified by `value` and `index` must exist.
         * * The alias proofs provided in the origin must be valid for the recycler's revision.
         * * The `aliases` provided must match the aliases derived from the proofs.
         * * The aliases must not have been already unloaded from this recycler.
         * * The number of aliases must be a power of two.
         * * The resulting consolidated value must not exceed [Config::MaximumExponent].
         */
        unload_recycler_into_coin: TxDescriptor<Anonymize<I8en8uvi5isgvj>>;
        /**
         * Unload a recycler to withdraw the underlying external asset.
         *
         * The origin must be [Origin::UnloadToken], which can be obtained from the transaction
         * extension [AsCoinage].
         *
         * When `fee` is [UnloadFee::Prepaid] (via free or paid unload token), no fee is deducted.
         * When `fee` is [UnloadFee::FromOutput], the fee is deducted from the unloaded assets.
         *
         * This function allows a user to withdraw their coins back into the underlying
         * asset (e.g., stablecoin).
         *
         * Parameters:
         * * `aliases`: the list of aliases corresponding to the member keys included in the
         * recycler. The proofs for these aliases are contained in the origin.
         * * `value` and `index`: identifies the recycler being unloaded.
         * * `_revision`: the recycler revision used for the alias_proofs.
         * * `to`: the destination account for the underlying asset.
         *
         * Requirements:
         * * The origin must be [Origin::UnloadToken].
         * * The recycler identified by `value` and `index` must exist.
         * * The alias proofs provided in the origin must be valid for the recycler's revision.
         * * The aliases must not have been already unloaded (except for the first one when `fee`
         * is [UnloadFee::FromOutput], which was pre-marked in the extension).
         */
        unload_recycler_into_external_asset: TxDescriptor<Anonymize<I8en8uvi5isgvj>>;
        /**
         * Pay the fee to register a member key for a paid unload token using a coin.
         *
         * The origin must be a [Origin::Coin], which can be obtained from the transaction
         * extension [AsCoinage].
         *
         * The coin is consumed. The fee is deducted from the coin's value and transferred to
         * [Config::FeeDestination]. The remaining value of the coin is destroyed.
         *
         * If the call fails, the origin coin is still consumed.
         *
         * To protect the user against varying fees, if the coin's value is less than the fee, the
         * call is invalid (an invalid call never goes into a block).
         *
         * The `proof_of_ownership` is a signature of the caller's account ID by the `member_key`.
         * This ensures the caller controls the member key to prevent front-running.
         *
         * Requirements:
         * * The coin's age must be less than [Config::MaximumAge].
         * * The coin value must be sufficient to cover the fee.
         * * The `member_key` must be valid and not already used.
         * * The `proof_of_ownership` must be valid.
         */
        pay_for_recycler_unload_fee_token_with_coin: TxDescriptor<Anonymize<I1b55a83kk37g4>>;
        /**
         * Pay the fee to register a member key for a paid unload token using the native currency.
         *
         * The origin must be Signed.
         *
         * This adds the `member_key` to a "paid unload token ring". Being part of this ring
         * allows the user to later generate an anonymous `UnloadToken` to unload a recycler.
         *
         * The fee is transferred from the caller to [Config::FeeDestination].
         *
         * The `proof_of_ownership` is a signature of the caller's account ID by the `member_key`.
         * This ensures the caller controls the member key to prevent front-running.
         *
         * Requirements:
         * * The `member_key` must be valid and not already used.
         * * The `proof_of_ownership` must be valid.
         */
        pay_for_recycler_unload_fee_token_with_native: TxDescriptor<Anonymize<I1b55a83kk37g4>>;
        /**
         * Pay the fee to register a member key for a paid unload token using the underlying asset
         * i.e. the stablecoin.
         *
         * The origin must be Signed.
         *
         * This adds the `member_key` to a "paid unload token ring". Being part of this ring
         * allows the user to later generate an anonymous `UnloadToken` to unload a recycler.
         *
         * The fee is transferred from the caller to [Config::FeeDestination].
         *
         * The `proof_of_ownership` is a signature of the caller's account ID by the `member_key`.
         * This ensures the caller controls the member key to prevent front-running.
         *
         * Requirements:
         * * The `member_key` must be valid and not already used.
         * * The `proof_of_ownership` must be valid.
         */
        pay_for_recycler_unload_fee_token_with_stable: TxDescriptor<Anonymize<I1b55a83kk37g4>>;
        /**
         * Unload a recycler into a mix of external asset and fresh vouchers.
         *
         * The origin must be [Origin::UnloadToken], which can be obtained from the transaction
         * extension [AsCoinage].
         *
         * This function allows a user to offboard part of the unloaded value into the underlying
         * asset while reminting the rest as fresh recycler vouchers.
         *
         * When `fee` is [UnloadFee::Prepaid], `external_asset_amount` is transferred as-is.
         * When `fee` is [UnloadFee::FromOutput], the fee is deducted from the specified
         * `external_asset_amount`, so the recipient receives the remainder.
         *
         * Parameters:
         * * `aliases`: the list of aliases corresponding to the member keys included in the
         * recycler. The proofs for these aliases are contained in the origin.
         * * `value` and `index`: identifies the recycler being unloaded.
         * * `revision`: the recycler revision used for the alias proofs.
         * * `to`: the destination account for the external asset portion.
         * * `external_asset_amount`: the gross asset portion to offboard from the unloaded value.
         * * `new_vouchers`: the fresh recycler vouchers to mint from the remaining unloaded value.
         *
         * The total unloaded value must always equal the asset portion plus the voucher portion.
         * In `FromOutput` mode, the asset portion must be large enough to cover the unload fee.
         *
         * Requirements:
         * * The origin must be [Origin::UnloadToken].
         * * The recycler identified by `value` and `index` must exist.
         * * The alias proofs provided in the origin must be valid for the recycler's revision.
         * * The aliases must not have been already unloaded (except for the first one when `fee`
         * is [UnloadFee::FromOutput], which was pre-marked in the extension).
         * * `new_vouchers` must not be empty, and all voucher member keys must be valid and
         * unused.
         * * The total unloaded value must equal `external_asset_amount` plus the total asset value
         * of `new_vouchers`.
         * * When using [UnloadFee::FromOutput], `external_asset_amount` must cover the fee.
         */
        unload_recycler_into_external_asset_and_vouchers: TxDescriptor<Anonymize<Ibg509ejf21uui>>;
        /**
         * Unload a recycler to withdraw the underlying external asset (non-anonymous).
         *
         * Convenience wrapper around [Self::unload_recyclers_into_external_asset_non_anonymous]
         * for the single-recycler case.
         *
         * See [Self::unload_recyclers_into_external_asset_non_anonymous] for full documentation.
         */
        unload_recycler_into_external_asset_non_anonymous: TxDescriptor<Anonymize<I59uphia91t9fq>>;
        /**
         * Unload multiple recyclers to withdraw the underlying external asset (non-anonymous).
         *
         * This is a non-anonymous version of [Self::unload_recyclers_into_external_asset]
         * where the fee is paid explicitly by the signer rather than through the anonymous
         * unload token ring, and for multiple recyclers.
         *
         * The fee charged is one unload token fee per recycler (i.e., `inputs.len()`).
         *
         * Parameters:
         * * `inputs`: A list of inputs, specifying the recycler and aliases to unload.
         * * `alias_proofs`: the proofs for all aliases across all inputs, signed over a message
         * that includes the signer. The proofs must correspond sequentially to the aliases in
         * `inputs`.
         * * `to`: the destination account for the asset.
         * * `fee_currency`: whether to pay the fee in native currency or stable asset.
         *
         * Requirements:
         * * The origin must be Signed.
         * * All specified recyclers must exist.
         * * The alias proofs must correspond sequentially to the aliases in `inputs`.
         * * `inputs` must not be empty and each element must contain at least one alias.
         * * The signer must have sufficient balance to pay the fee (one fee per recycler).
         */
        unload_recyclers_into_external_asset_non_anonymous: TxDescriptor<Anonymize<Iagbupr13a1rnf>>;
        /**
         * Unload a recycler to mint multiple new coins (split).
         *
         * The origin must be a [Origin::UnloadToken] with `fee: UnloadFee::Prepaid`.
         *
         * This function combines the functionality of [Self::unload_recycler_into_coin] and
         * [Self::split] in a single atomic operation. The resulting coins' age is 1 because
         * the action of splitting age coins. This is also important because resulting coins
         * are not entirely fresh, they can be linked to other coins.
         *
         * Unlike [Self::unload_recycler_into_coin], this call does **not** require the number of
         * aliases to be a power of two.
         *
         * Parameters:
         * * `aliases`: the list of aliases corresponding to the member keys included in the
         * recycler. The proofs for these aliases are contained in the origin.
         * * `value` and `index`: identifies the recycler being unloaded.
         * * `revision`: the recycler revision used for the alias_proofs.
         * * `split_into`: a vector of pairs, each pair containing a coin value and a list of
         * destination account ids.
         * * `max_fee`: the maximum fee the caller is willing to pay, expressed in the underlying
         * asset balance. It must be equal to the difference between the total value of the
         * unloaded coins and the total value of the new coins defined in `split_into`.
         *
         * When using [UnloadFee::Prepaid], this must be 0.
         * When using [UnloadFee::FromOutput], this amount is deducted from the input: the
         * network fee is transferred to [Config::FeeDestination] and any remainder is burned.
         * The caller can query `get_paid_unload_token_fee_in_asset` to estimate the fee.
         *
         * This parameter serves as a safeguard: the transaction is rejected at validation if the
         * actual network fee exceeds `max_fee`, protecting the caller from excessive fee
         * increases that would render the argument `split_into` invalid (unloaded funds must be
         * higher than the split plus the fee).
         *
         * Requirements:
         * * The origin must be [Origin::UnloadToken].
         * * The recycler identified by `value` and `index` must exist.
         * * The alias proofs provided in the origin must be valid for the recycler's revision.
         * * The `aliases` provided must match the aliases derived from the proofs.
         * * The total value of the new coins defined in `split_into` plus `max_fee` must equal the
         * total value of the unloaded coins.
         * * `max_fee` must be a multiple of the minimum coin. (This is implied by the condition
         * above).
         * * Each destination account must not already have a coin.
         * * When using [UnloadFee::Prepaid], `max_fee` must be 0.
         * * When using [UnloadFee::FromOutput], `max_fee` must cover the network fee.
         */
        unload_recycler_into_coins: TxDescriptor<Anonymize<I497d2v63rjmg>>;
        /**
         * Directly offboard a fresh, 0-age coin into the underlying external asset.
         *
         * The origin must be a [Origin::Coin], obtained through [AsCoinage] using `AsCoin`.
         *
         * Because the coin must be fresh (`age == 0`), this call bypasses the
         * recycler/unload-token offboarding flow and releases the underlying asset directly.
         *
         * Parameters:
         * * `to`: destination account that receives the released underlying asset amount.
         *
         * Requirements:
         * * The origin must be [Origin::Coin].
         * * The coin must be fresh: `coin.age == 0`.
         * * The coin value must be representable as underlying-asset amount.
         */
        direct_offboard_coin_into_external_asset: TxDescriptor<Anonymize<Iadkk9nq2cqqve>>;
        /**
         * Set the underlying asset id used by the pallet.
         *
         * The origin must satisfy [`Config::UnderlyingAssetIdManager`]. The setter is
         * **single-use**: calling it again after the asset id has been set returns
         * [`Error::AssetIdAlreadySet`]. Changing the underlying asset after coins exist would
         * orphan the held balances of every in-flight coin, so the on-chain decision is
         * intentionally one-shot.
         *
         * The asset id must already exist in [`Config::Fungibles`].
         */
        set_underlying_asset_id: TxDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * Clean up an expired recycler.
         *
         * This is a maintenance call. The origin must be authorized and from local source.
         *
         * This removes an old recycler that has exceeded its expiration time.
         * Any remaining (not unloaded) value in the recycler is considered lost and added to
         * [TotalValueOfDestroyedCoins].
         */
        clean_recycler: TxDescriptor<Anonymize<Icnkee0to4c5ac>>;
        /**
         * Cleanup storage for consumed free unload tokens of old periods.
         *
         * This is a maintenance call. The origin must be authorized and from local source.
         */
        clean_consumed_free_token: TxDescriptor<Anonymize<I7ts20td7b1pmf>>;
        /**
         * Clean up a single ring in an expired paid unload token collection.
         *
         * This is a maintenance call. The origin must be authorized and from local source.
         * Rings must be cleaned sequentially (ring 0 first, then 1, etc.) before the
         * collection can be deleted via
         * [`delete_expired_paid_unload_token_collection`](Self::delete_expired_paid_unload_token_collection).
         */
        clean_paid_unload_token_ring: TxDescriptor<Anonymize<I7315hlp5liq47>>;
        /**
         * Clean up dust for recyclers.
         *
         * This is a maintenance call. The origin must be authorized and from local source.
         * Removes up to DUST_CLEANUP_BATCH_SIZE unloaded alias entries per call to bound the
         * operation.
         */
        clean_recycler_dust: TxDescriptor<undefined>;
        /**
         * Clean up dust for paid unload tokens.
         *
         * This is a maintenance call. The origin must be authorized and from local source.
         */
        clean_paid_unload_token_dust: TxDescriptor<undefined>;
        /**
         * Delete an expired paid unload token collection after all rings have been cleaned.
         *
         * This is a maintenance call. The origin must be authorized and from local source.
         * All rings must have been cleaned via
         * [`clean_paid_unload_token_ring`](Self::clean_paid_unload_token_ring) before this
         * can be called.
         */
        delete_expired_paid_unload_token_collection: TxDescriptor<Anonymize<I7ts20td7b1pmf>>;
    };
    MembersNotifier: {
        /**
         * Registers the parachain as a subscriber.
         * The initial state will be sent over shortly via XCM.
         *
         * ## Origin
         * Requires `ManageOrigin` (governance/root).
         *
         * ## Parameters
         * - `subscriber_parachain_id`: The ParaId of the subscribing parachain.
         * - `members_collections`: List of collection identifiers to subscribe to and their
         * respective ring exponents.
         * - `pallet_index`: Pallet index of members-subscriber on the subscriber chain.
         */
        subscribe: TxDescriptor<Anonymize<Ic73rrpct6ckoa>>;
        /**
         * Unsubscribes a parachain.
         *
         * ## Origin
         * - **Self-unsubscribe**: Subscriber parachain via XCM (`EnsureSubscriberOrigin`)
         * - **Governance unsubscribe**: Requires `ManageOrigin`
         *
         * ## Parameters
         * - `subscriber_parachain_id`: The ParaId to unsubscribe. Required for governance, ignored
         * for self-unsubscribe (derived from XCM origin).
         */
        unsubscribe: TxDescriptor<Anonymize<Ib1hmb261fe7mh>>;
        /**
         * Requests replay of specific ring roots.
         *
         * Permissionless — any signed origin can request a replay for any subscriber.
         * The subscriber parachain is identified by the `subscriber_parachain_id` parameter.
         *
         * Parameters:
         * - `subscriber_parachain_id`: The ParaId of the subscriber.
         * - `identifier`: Collection identifier.
         * - `ring_root_indices`: List of ring root indices, must be in strictly ascending order.
         */
        request_replay: TxDescriptor<Anonymize<I9jfggcqa8oi6c>>;
        /**
         * Enqueues pending updates into a sealed batch for distribution.
         *
         * Authorized call submitted by the offchain worker.
         */
        enqueue_updates: TxDescriptor<Anonymize<I437snu8jbuaj2>>;
        /**
         * Sends the current batch to a specific subscriber.
         *
         * Authorized maintenance call submitted by the offchain worker.
         */
        send_batch: TxDescriptor<Anonymize<Ic44opm4fbhp4r>>;
        /**
         * Sends one page of initialization data to a subscriber.
         *
         * Authorized maintenance call submitted by the offchain worker.
         */
        send_init_page: TxDescriptor<Anonymize<Ia7k5rk3a67fgt>>;
        /**
         * Abandons a stuck batch that exceeded `StuckBatchTimeout`.
         * Subscribers that did not receive the batch can recover via `request_replay`.
         *
         * Authorized maintenance call submitted by the offchain worker when a batch has
         * been active longer than `StuckBatchTimeout`.
         */
        abandon_stuck_batch: TxDescriptor<undefined>;
    };
    Airdrop: {
        /**
         * Schedule a new airdrop event. Origin must be `ManagerOrigin`. The prize allocation is
         * held in the pallet's pot account. The pot is assumed to be pre-funded.
         *
         * Cross-pallet callers should use the [`crate::types::Airdrop::schedule`] trait method
         * instead, which debits a caller-supplied `source` account.
         */
        schedule_event: TxDescriptor<Anonymize<Ie9gieran6hmh7>>;
        /**
         * Remove a previously scheduled event. The event must not have already
         * started, otherwise this call will fail.
         */
        remove_scheduled_event: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * Enable an asset for use in airdrop events. The origin must be `ManagerOrigin` only.
         *
         * Transfers the asset's current minimum balance from `source` to the pallet's pot so the
         * pot's asset account stays alive while events hold prize funds against it.
         */
        enable_asset: TxDescriptor<Anonymize<I2l0pq1htsnh8g>>;
        /**
         * Disable an asset previously enabled with `enable_asset`. Refunds the originally-funded
         * amount from the pot to `beneficiary`. The origin must be `ManagerOrigin` only.
         *
         * The manager is responsible for ensuring no events still reference this asset before
         * disabling, but this is safe since scheduling an event is permissioned.
         */
        disable_asset: TxDescriptor<Anonymize<Icg4lihlimlj9s>>;
        /**
         * OCW-driven: transition `Scheduled → Registering` when
         * `registration_starts` is reached.
         */
        start_registration_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: at `draw_time`:
         * - close registration
         * - capture randomness
         * - compute the target winner count
         * - release the unused-slot prize allocation up-front
         * - transition `Registering → DrawWinners`
         *
         * The draw itself is performed in batches by `draw_winners_authorized`.
         */
        close_registration_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: draw up to `DrawLimit` winners per call.
         *
         * After all the winners are drawn, the transition to `Claiming` is performed by the
         * separate `close_drawing_authorized`.
         */
        draw_winners_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: once `draw_winners_authorized` has filled the winner set, transition the
         * event from `DrawWinners` to `Claiming`.
         */
        close_drawing_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: at `end_time` close claiming and enter the first clean-up phase.
         */
        close_claiming_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: First step of clean-up is to clear up to `ClearLimit` entries from
         * `Registrations`. When the storage is fully drained, transitions to `ClearingWinners`.
         */
        clean_up_registrations_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: Second step of clean-up is to clear up to `ClearLimit` entries from
         * `Winners`. When the storage is fully drained, transitions to `Finalizing`.
         */
        clean_up_winners_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
         * OCW-driven: Third step of clean-up is to release the unclaimed prize allocation and
         * remove the event.
         */
        finalize_authorized: TxDescriptor<Anonymize<Ib4o08d7u3o37d>>;
    };
    Honour: {
        /**
         * Bestow a vote.
         *
         * Accepts only the [`Origin::Voter`] origin, which is created by verifying a ring proof
         * in the [`VoterAuth`](extension::VoterAuth) transaction extension.
         */
        bestow: TxDescriptor<Anonymize<Ie5m07j5sdjl2g>>;
    };
    MultiBlockMigrations: {
        /**
         * Allows root to set a cursor to forcefully start, stop or forward the migration process.
         *
         * Should normally not be needed and is only in place as emergency measure. Note that
         * restarting the migration process in this manner will not call the
         * [`MigrationStatusHandler::started`] hook or emit an `UpgradeStarted` event.
         */
        force_set_cursor: TxDescriptor<Anonymize<Ibou4u1engb441>>;
        /**
         * Allows root to set an active cursor to forcefully start/forward the migration process.
         *
         * This is an edge-case version of [`Self::force_set_cursor`] that allows to set the
         * `started_at` value to the next block number. Otherwise this would not be possible, since
         * `force_set_cursor` takes an absolute block number. Setting `started_at` to `None`
         * indicates that the current block number plus one should be used.
         */
        force_set_active_cursor: TxDescriptor<Anonymize<Id6nbvqoqdj4o2>>;
        /**
         * Forces the onboarding of the migrations.
         *
         * This process happens automatically on a runtime upgrade. It is in place as an emergency
         * measurement. The cursor needs to be `None` for this to succeed.
         */
        force_onboard_mbms: TxDescriptor<undefined>;
        /**
         * Clears the `Historic` set.
         *
         * `map_cursor` must be set to the last value that was returned by the
         * `HistoricCleared` event. The first time `None` can be used. `limit` must be chosen in a
         * way that will result in a sensible weight.
         */
        clear_historic: TxDescriptor<Anonymize<I95iqep3b8snn9>>;
    };
};
type IEvent = {
    System: {
        /**
         * An extrinsic completed successfully.
         */
        ExtrinsicSuccess: PlainDescriptor<Anonymize<Ia82mnkmeo2rhc>>;
        /**
         * An extrinsic failed.
         */
        ExtrinsicFailed: PlainDescriptor<Anonymize<Ibmkdg0la4lmik>>;
        /**
         * `:code` was updated to the code with the given hash.
         */
        CodeUpdated: PlainDescriptor<Anonymize<I1jm8m1rh9e20v>>;
        /**
         * A new account was created.
         */
        NewAccount: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * An account was reaped.
         */
        KilledAccount: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * On on-chain remark happened.
         */
        Remarked: PlainDescriptor<Anonymize<I855j4i3kr8ko1>>;
        /**
         * An upgrade was authorized.
         */
        UpgradeAuthorized: PlainDescriptor<Anonymize<Ibgl04rn6nbfm6>>;
        /**
         * An invalid authorized upgrade was rejected while trying to apply it.
         */
        RejectedInvalidAuthorizedUpgrade: PlainDescriptor<Anonymize<I1dfctsnhih1bs>>;
    };
    ParachainSystem: {
        /**
         * The validation function has been scheduled to apply.
         */
        ValidationFunctionStored: PlainDescriptor<undefined>;
        /**
         * The validation function was applied as of the contained relay chain block number.
         */
        ValidationFunctionApplied: PlainDescriptor<Anonymize<Idd7hd99u0ho0n>>;
        /**
         * The relay-chain aborted the upgrade process.
         */
        ValidationFunctionDiscarded: PlainDescriptor<undefined>;
        /**
         * Some downward messages have been received and will be processed.
         */
        DownwardMessagesReceived: PlainDescriptor<Anonymize<Iafscmv8tjf0ou>>;
        /**
         * Downward messages were processed using the given weight.
         */
        DownwardMessagesProcessed: PlainDescriptor<Anonymize<I100l07kaehdlp>>;
        /**
         * An upward message was sent to the relay chain.
         */
        UpwardMessageSent: PlainDescriptor<Anonymize<I6gnbnvip5vvdi>>;
    };
    Balances: {
        /**
         * An account was created with some free balance.
         */
        Endowed: PlainDescriptor<Anonymize<Icv68aq8841478>>;
        /**
         * An account was removed whose balance was non-zero but below ExistentialDeposit,
         * resulting in an outright loss.
         */
        DustLost: PlainDescriptor<Anonymize<Ic262ibdoec56a>>;
        /**
         * Transfer succeeded.
         */
        Transfer: PlainDescriptor<Anonymize<Iflcfm9b6nlmdd>>;
        /**
         * A balance was set by root.
         */
        BalanceSet: PlainDescriptor<Anonymize<Ijrsf4mnp3eka>>;
        /**
         * Some balance was reserved (moved from free to reserved).
         */
        Reserved: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some balance was unreserved (moved from reserved to free).
         */
        Unreserved: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some balance was moved from the reserve of the first account to the second account.
         * Final argument indicates the destination balance type.
         */
        ReserveRepatriated: PlainDescriptor<Anonymize<I8tjvj9uq4b7hi>>;
        /**
         * Some amount was deposited (e.g. for transaction fees).
         */
        Deposit: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some amount was withdrawn from the account (e.g. for transaction fees).
         */
        Withdraw: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some amount was removed from the account (e.g. for misbehavior).
         */
        Slashed: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some amount was minted into an account.
         */
        Minted: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some credit was balanced and added to the TotalIssuance.
         */
        MintedCredit: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
        /**
         * Some amount was burned from an account.
         */
        Burned: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some debt has been dropped from the Total Issuance.
         */
        BurnedDebt: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
        /**
         * Some amount was suspended from an account (it can be restored later).
         */
        Suspended: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some amount was restored into an account.
         */
        Restored: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * An account was upgraded.
         */
        Upgraded: PlainDescriptor<Anonymize<I4cbvqmqadhrea>>;
        /**
         * Total issuance was increased by `amount`, creating a credit to be balanced.
         */
        Issued: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
        /**
         * Total issuance was decreased by `amount`, creating a debt to be balanced.
         */
        Rescinded: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
        /**
         * Some balance was locked.
         */
        Locked: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some balance was unlocked.
         */
        Unlocked: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some balance was frozen.
         */
        Frozen: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * Some balance was thawed.
         */
        Thawed: PlainDescriptor<Anonymize<Id5fm4p8lj5qgi>>;
        /**
         * The `TotalIssuance` was forcefully changed.
         */
        TotalIssuanceForced: PlainDescriptor<Anonymize<I4fooe9dun9o0t>>;
        /**
         * Some balance was placed on hold.
         */
        Held: PlainDescriptor<Anonymize<I4t941tu6n95pd>>;
        /**
         * Held balance was burned from an account.
         */
        BurnedHeld: PlainDescriptor<Anonymize<I4t941tu6n95pd>>;
        /**
         * A transfer of `amount` on hold from `source` to `dest` was initiated.
         */
        TransferOnHold: PlainDescriptor<Anonymize<I7a812tlv1a711>>;
        /**
         * The `transferred` balance is placed on hold at the `dest` account.
         */
        TransferAndHold: PlainDescriptor<Anonymize<I3osgdo4c94kio>>;
        /**
         * Some balance was released from hold.
         */
        Released: PlainDescriptor<Anonymize<I4t941tu6n95pd>>;
        /**
         * An unexpected/defensive event was triggered.
         */
        Unexpected: PlainDescriptor<Anonymize<Iph9c4rn81ub2>>;
    };
    TransactionPayment: {
        /**
         * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
         * has been paid by `who`.
         */
        TransactionFeePaid: PlainDescriptor<Anonymize<Ier2cke86dqbr2>>;
    };
    SkipFeelessPayment: {
        /**
         * A transaction fee was skipped.
         */
        FeeSkipped: PlainDescriptor<Anonymize<Ia19q5nd942d8c>>;
    };
    OriginRestriction: {
        /**
         * Usage for an entity is cleaned.
         */
        UsageCleaned: PlainDescriptor<Anonymize<Iea5hvin03frku>>;
    };
    Assets: {
        /**
         * Some asset class was created.
         */
        Created: PlainDescriptor<Anonymize<Icqe266pmnr25o>>;
        /**
         * Some assets were issued.
         */
        Issued: PlainDescriptor<Anonymize<I5hoiph0lqphp>>;
        /**
         * Some assets were transferred.
         */
        Transferred: PlainDescriptor<Anonymize<I5k7oropl9ofc7>>;
        /**
         * Some assets were destroyed.
         */
        Burned: PlainDescriptor<Anonymize<I48vagp1omigob>>;
        /**
         * The management team changed.
         */
        TeamChanged: PlainDescriptor<Anonymize<Ib5tst4ppem1g6>>;
        /**
         * The owner changed.
         */
        OwnerChanged: PlainDescriptor<Anonymize<Ibn64edsrg3737>>;
        /**
         * Some account `who` was frozen.
         */
        Frozen: PlainDescriptor<Anonymize<I83r9d02dh47j9>>;
        /**
         * Some account `who` was thawed.
         */
        Thawed: PlainDescriptor<Anonymize<I83r9d02dh47j9>>;
        /**
         * Some asset `asset_id` was frozen.
         */
        AssetFrozen: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * Some asset `asset_id` was thawed.
         */
        AssetThawed: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * Accounts were destroyed for given asset.
         */
        AccountsDestroyed: PlainDescriptor<Anonymize<I3jnhifvaeuama>>;
        /**
         * Approvals were destroyed for given asset.
         */
        ApprovalsDestroyed: PlainDescriptor<Anonymize<I8n1gia0lo42ok>>;
        /**
         * An asset class is in the process of being destroyed.
         */
        DestructionStarted: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * An asset class was destroyed.
         */
        Destroyed: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * Some asset class was force-created.
         */
        ForceCreated: PlainDescriptor<Anonymize<Ibn64edsrg3737>>;
        /**
         * New metadata has been set for an asset.
         */
        MetadataSet: PlainDescriptor<Anonymize<I6gb0o7lqjfdjq>>;
        /**
         * Metadata has been cleared for an asset.
         */
        MetadataCleared: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * (Additional) funds have been approved for transfer to a destination account.
         */
        ApprovedTransfer: PlainDescriptor<Anonymize<Idh36v6iegkmpq>>;
        /**
         * An approval for account `delegate` was cancelled by `owner`.
         */
        ApprovalCancelled: PlainDescriptor<Anonymize<I27hnueutmchbe>>;
        /**
         * An `amount` was transferred in its entirety from `owner` to `destination` by
         * the approved `delegate`.
         */
        TransferredApproved: PlainDescriptor<Anonymize<Iectm2em66uhao>>;
        /**
         * An asset has had its attributes changed by the `Force` origin.
         */
        AssetStatusChanged: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * The min_balance of an asset has been updated by the asset owner.
         */
        AssetMinBalanceChanged: PlainDescriptor<Anonymize<I7q57goff3j72h>>;
        /**
         * Some account `who` was created with a deposit from `depositor`.
         */
        Touched: PlainDescriptor<Anonymize<Ibe49veu9i9nro>>;
        /**
         * Some account `who` was blocked.
         */
        Blocked: PlainDescriptor<Anonymize<I83r9d02dh47j9>>;
        /**
         * Some assets were deposited (e.g. for transaction fees).
         */
        Deposited: PlainDescriptor<Anonymize<I1rnkmiu7usb82>>;
        /**
         * Some assets were withdrawn from the account (e.g. for transaction fees).
         */
        Withdrawn: PlainDescriptor<Anonymize<I1rnkmiu7usb82>>;
        /**
         * Reserve information was set or updated for `asset_id`.
         */
        ReservesUpdated: PlainDescriptor<Anonymize<Iadvnek4gbu68j>>;
        /**
         * Reserve information was removed for `asset_id`.
         */
        ReservesRemoved: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
        /**
         * Some assets were issued as Credit (no owner yet).
         */
        IssuedCredit: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
        /**
         * Some assets Credit was destroyed.
         */
        BurnedCredit: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
        /**
         * Some assets were burned and a Debt was created.
         */
        IssuedDebt: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
        /**
         * Some assets Debt was destroyed (and assets issued).
         */
        BurnedDebt: PlainDescriptor<Anonymize<Ibtugueatkkr9s>>;
    };
    AssetsHolder: {
        /**
         * `who`s balance on hold was increased by `amount`.
         */
        Held: PlainDescriptor<Anonymize<I6felmv64s40c4>>;
        /**
         * `who`s balance on hold was decreased by `amount`.
         */
        Released: PlainDescriptor<Anonymize<I6felmv64s40c4>>;
        /**
         * `who`s balance on hold was burned by `amount`.
         */
        Burned: PlainDescriptor<Anonymize<I6felmv64s40c4>>;
    };
    AssetRate: {
        /**
        
         */
        AssetRateCreated: PlainDescriptor<Anonymize<I72jcvr86rnvv8>>;
        /**
        
         */
        AssetRateRemoved: PlainDescriptor<Anonymize<I90c919drss29e>>;
        /**
        
         */
        AssetRateUpdated: PlainDescriptor<Anonymize<I5k7edfft48vsq>>;
    };
    AssetTxPayment: {
        /**
         * A transaction fee `actual_fee`, of which `tip` was added to the minimum inclusion fee,
         * has been paid by `who` in an asset `asset_id`.
         */
        AssetTxFeePaid: PlainDescriptor<Anonymize<Iaeqj2ebnvkjqe>>;
    };
    CollatorSelection: {
        /**
         * New Invulnerables were set.
         */
        NewInvulnerables: PlainDescriptor<Anonymize<I39t01nnod9109>>;
        /**
         * A new Invulnerable was added.
         */
        InvulnerableAdded: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * An Invulnerable was removed.
         */
        InvulnerableRemoved: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * The number of desired candidates was set.
         */
        NewDesiredCandidates: PlainDescriptor<Anonymize<I1qmtmbe5so8r3>>;
        /**
         * The candidacy bond was set.
         */
        NewCandidacyBond: PlainDescriptor<Anonymize<Ih99m6ehpcar7>>;
        /**
         * A new candidate joined.
         */
        CandidateAdded: PlainDescriptor<Anonymize<Idgorhsbgdq2ap>>;
        /**
         * Bond of a candidate updated.
         */
        CandidateBondUpdated: PlainDescriptor<Anonymize<Idgorhsbgdq2ap>>;
        /**
         * A candidate was removed.
         */
        CandidateRemoved: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * An account was replaced in the candidate list by another one.
         */
        CandidateReplaced: PlainDescriptor<Anonymize<I9ubb2kqevnu6t>>;
        /**
         * An account was unable to be added to the Invulnerables because they did not have keys
         * registered. Other Invulnerables may have been set.
         */
        InvalidInvulnerableSkipped: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
    };
    Session: {
        /**
         * New session has happened. Note that the argument is the session index, not the
         * block number as the type might suggest.
         */
        NewSession: PlainDescriptor<Anonymize<I2hq50pu2kdjpo>>;
        /**
         * The `NewSession` event in the current block also implies a new validator set to be
         * queued.
         */
        NewQueued: PlainDescriptor<undefined>;
        /**
         * Validator has been disabled.
         */
        ValidatorDisabled: PlainDescriptor<Anonymize<I9acqruh7322g2>>;
        /**
         * Validator has been re-enabled.
         */
        ValidatorReenabled: PlainDescriptor<Anonymize<I9acqruh7322g2>>;
    };
    XcmpQueue: {
        /**
         * An HRMP message was sent to a sibling parachain.
         */
        XcmpMessageSent: PlainDescriptor<Anonymize<I137t1cld92pod>>;
    };
    PolkadotXcm: {
        /**
         * Execution of an XCM message was attempted.
         */
        Attempted: PlainDescriptor<Anonymize<I61d51nv4cou88>>;
        /**
         * An XCM message was sent.
         */
        Sent: PlainDescriptor<Anonymize<If8u5kl4h8070m>>;
        /**
         * An XCM message failed to send.
         */
        SendFailed: PlainDescriptor<Anonymize<Ibmuil6p3vl83l>>;
        /**
         * An XCM message failed to process.
         */
        ProcessXcmError: PlainDescriptor<Anonymize<I7lul91g50ae87>>;
        /**
         * Query response received which does not match a registered query. This may be because a
         * matching query was never registered, it may be because it is a duplicate response, or
         * because the query timed out.
         */
        UnexpectedResponse: PlainDescriptor<Anonymize<Icl7nl1rfeog3i>>;
        /**
         * Query response has been received and is ready for taking with `take_response`. There is
         * no registered notification call.
         */
        ResponseReady: PlainDescriptor<Anonymize<Iasr6pj6shs0fl>>;
        /**
         * Query response has been received and query is removed. The registered notification has
         * been dispatched and executed successfully.
         */
        Notified: PlainDescriptor<Anonymize<I2uqmls7kcdnii>>;
        /**
         * Query response has been received and query is removed. The registered notification
         * could not be dispatched because the dispatch weight is greater than the maximum weight
         * originally budgeted by this runtime for the query result.
         */
        NotifyOverweight: PlainDescriptor<Anonymize<Idg69klialbkb8>>;
        /**
         * Query response has been received and query is removed. There was a general error with
         * dispatching the notification call.
         */
        NotifyDispatchError: PlainDescriptor<Anonymize<I2uqmls7kcdnii>>;
        /**
         * Query response has been received and query is removed. The dispatch was unable to be
         * decoded into a `Call`; this might be due to dispatch function having a signature which
         * is not `(origin, QueryId, Response)`.
         */
        NotifyDecodeFailed: PlainDescriptor<Anonymize<I2uqmls7kcdnii>>;
        /**
         * Expected query response has been received but the origin location of the response does
         * not match that expected. The query remains registered for a later, valid, response to
         * be received and acted upon.
         */
        InvalidResponder: PlainDescriptor<Anonymize<I7r6b7145022pp>>;
        /**
         * Expected query response has been received but the expected origin location placed in
         * storage by this runtime previously cannot be decoded. The query remains registered.
         *
         * This is unexpected (since a location placed in storage in a previously executing
         * runtime should be readable prior to query timeout) and dangerous since the possibly
         * valid response will be dropped. Manual governance intervention is probably going to be
         * needed.
         */
        InvalidResponderVersion: PlainDescriptor<Anonymize<Icl7nl1rfeog3i>>;
        /**
         * Received query response has been read and removed.
         */
        ResponseTaken: PlainDescriptor<Anonymize<I30pg328m00nr3>>;
        /**
         * Some assets have been placed in an asset trap.
         */
        AssetsTrapped: PlainDescriptor<Anonymize<Icmrn7bogp28cs>>;
        /**
         * An XCM version change notification message has been attempted to be sent.
         *
         * The cost of sending it (borne by the chain) is included.
         */
        VersionChangeNotified: PlainDescriptor<Anonymize<I7m9b5plj4h5ot>>;
        /**
         * The supported version of a location has been changed. This might be through an
         * automatic notification or a manual intervention.
         */
        SupportedVersionChanged: PlainDescriptor<Anonymize<I9kt8c221c83ln>>;
        /**
         * A given location which had a version change subscription was dropped owing to an error
         * sending the notification to it.
         */
        NotifyTargetSendFail: PlainDescriptor<Anonymize<I9onhk772nfs4f>>;
        /**
         * A given location which had a version change subscription was dropped owing to an error
         * migrating the location to our new XCM format.
         */
        NotifyTargetMigrationFail: PlainDescriptor<Anonymize<I3l6bnksrmt56r>>;
        /**
         * Expected query response has been received but the expected querier location placed in
         * storage by this runtime previously cannot be decoded. The query remains registered.
         *
         * This is unexpected (since a location placed in storage in a previously executing
         * runtime should be readable prior to query timeout) and dangerous since the possibly
         * valid response will be dropped. Manual governance intervention is probably going to be
         * needed.
         */
        InvalidQuerierVersion: PlainDescriptor<Anonymize<Icl7nl1rfeog3i>>;
        /**
         * Expected query response has been received but the querier location of the response does
         * not match the expected. The query remains registered for a later, valid, response to
         * be received and acted upon.
         */
        InvalidQuerier: PlainDescriptor<Anonymize<Idh09k0l2pmdcg>>;
        /**
         * A remote has requested XCM version change notification from us and we have honored it.
         * A version information message is sent to them and its cost is included.
         */
        VersionNotifyStarted: PlainDescriptor<Anonymize<I7uoiphbm0tj4r>>;
        /**
         * We have requested that a remote chain send us XCM version change notifications.
         */
        VersionNotifyRequested: PlainDescriptor<Anonymize<I7uoiphbm0tj4r>>;
        /**
         * We have requested that a remote chain stops sending us XCM version change
         * notifications.
         */
        VersionNotifyUnrequested: PlainDescriptor<Anonymize<I7uoiphbm0tj4r>>;
        /**
         * Fees were paid from a location for an operation (often for using `SendXcm`).
         */
        FeesPaid: PlainDescriptor<Anonymize<I512p1n7qt24l8>>;
        /**
         * Some assets have been claimed from an asset trap
         */
        AssetsClaimed: PlainDescriptor<Anonymize<Icmrn7bogp28cs>>;
        /**
         * A XCM version migration finished.
         */
        VersionMigrationFinished: PlainDescriptor<Anonymize<I6s1nbislhk619>>;
        /**
         * An `aliaser` location was authorized by `target` to alias it, authorization valid until
         * `expiry` block number.
         */
        AliasAuthorized: PlainDescriptor<Anonymize<I3gghqnh2mj0is>>;
        /**
         * `target` removed alias authorization for `aliaser`.
         */
        AliasAuthorizationRemoved: PlainDescriptor<Anonymize<I6iv852roh6t3h>>;
        /**
         * `target` removed all alias authorizations.
         */
        AliasesAuthorizationsRemoved: PlainDescriptor<Anonymize<I9oc2o6itbiopq>>;
    };
    CumulusXcm: {
        /**
         * Downward message is invalid XCM.
         * \[ id \]
         */
        InvalidFormat: PlainDescriptor<SizedHex<32>>;
        /**
         * Downward message is unsupported version of XCM.
         * \[ id \]
         */
        UnsupportedVersion: PlainDescriptor<SizedHex<32>>;
        /**
         * Downward message executed with the given outcome.
         * \[ id, outcome \]
         */
        ExecutedDownward: PlainDescriptor<Anonymize<Ibslgga81p36aa>>;
    };
    MessageQueue: {
        /**
         * Message discarded due to an error in the `MessageProcessor` (usually a format error).
         */
        ProcessingFailed: PlainDescriptor<Anonymize<I1rvj4ubaplho0>>;
        /**
         * Message is processed.
         */
        Processed: PlainDescriptor<Anonymize<Ia3uu7lqcc1q1i>>;
        /**
         * Message placed in overweight queue.
         */
        OverweightEnqueued: PlainDescriptor<Anonymize<I7crucfnonitkn>>;
        /**
         * This page was reaped.
         */
        PageReaped: PlainDescriptor<Anonymize<I7tmrp94r9sq4n>>;
    };
    Utility: {
        /**
         * Batch of dispatches did not complete fully. Index of first failing dispatch given, as
         * well as the error.
         */
        BatchInterrupted: PlainDescriptor<Anonymize<I8q7bne2mpmuvt>>;
        /**
         * Batch of dispatches completed fully with no error.
         */
        BatchCompleted: PlainDescriptor<undefined>;
        /**
         * Batch of dispatches completed but has errors.
         */
        BatchCompletedWithErrors: PlainDescriptor<undefined>;
        /**
         * A single item within a Batch of dispatches has completed with no error.
         */
        ItemCompleted: PlainDescriptor<undefined>;
        /**
         * A single item within a Batch of dispatches has completed with error.
         */
        ItemFailed: PlainDescriptor<Anonymize<I4e44onfj09kj9>>;
        /**
         * A call was dispatched.
         */
        DispatchedAs: PlainDescriptor<Anonymize<Iff4dsuaudcmul>>;
        /**
         * Main call was dispatched.
         */
        IfElseMainSuccess: PlainDescriptor<undefined>;
        /**
         * The fallback call was dispatched.
         */
        IfElseFallbackCalled: PlainDescriptor<Anonymize<I6at1u8h56mk6v>>;
    };
    Multisig: {
        /**
         * A new multisig operation has begun.
         */
        NewMultisig: PlainDescriptor<Anonymize<Iep27ialq4a7o7>>;
        /**
         * A multisig operation has been approved by someone.
         */
        MultisigApproval: PlainDescriptor<Anonymize<Iasu5jvoqr43mv>>;
        /**
         * A multisig operation has been executed.
         */
        MultisigExecuted: PlainDescriptor<Anonymize<Iip94ct8liqkr>>;
        /**
         * A multisig operation has been cancelled.
         */
        MultisigCancelled: PlainDescriptor<Anonymize<I5qolde99acmd1>>;
        /**
         * The deposit for a multisig operation has been updated/poked.
         */
        DepositPoked: PlainDescriptor<Anonymize<I8gtde5abn1g9a>>;
    };
    Sudo: {
        /**
         * A sudo call just took place.
         */
        Sudid: PlainDescriptor<Anonymize<Icanjvelodp3>>;
        /**
         * The sudo key has been updated.
         */
        KeyChanged: PlainDescriptor<Anonymize<I5rtkmhm2dng4u>>;
        /**
         * The key was permanently removed.
         */
        KeyRemoved: PlainDescriptor<undefined>;
        /**
         * A [sudo_as](Pallet::sudo_as) call just took place.
         */
        SudoAsDone: PlainDescriptor<Anonymize<Icanjvelodp3>>;
    };
    Proxy: {
        /**
         * A proxy was executed correctly, with the given.
         */
        ProxyExecuted: PlainDescriptor<Anonymize<Iff4dsuaudcmul>>;
        /**
         * A pure account has been created by new proxy with given
         * disambiguation index and proxy type.
         */
        PureCreated: PlainDescriptor<Anonymize<Iquobi9ukq7tb>>;
        /**
         * A pure proxy was killed by its spawner.
         */
        PureKilled: PlainDescriptor<Anonymize<I4mj21qcksiuf3>>;
        /**
         * An announcement was placed to make a call in the future.
         */
        Announced: PlainDescriptor<Anonymize<I2ur0oeqg495j8>>;
        /**
         * A proxy was added.
         */
        ProxyAdded: PlainDescriptor<Anonymize<I8v2su1f60qoae>>;
        /**
         * A proxy was removed.
         */
        ProxyRemoved: PlainDescriptor<Anonymize<I8v2su1f60qoae>>;
        /**
         * A deposit stored for proxies or announcements was poked / updated.
         */
        DepositPoked: PlainDescriptor<Anonymize<I1bhd210c3phjj>>;
    };
    Identity: {
        /**
         * A name was set or reset (which will remove all judgements).
         */
        IdentitySet: PlainDescriptor<Anonymize<I4cbvqmqadhrea>>;
        /**
         * A name was cleared, and the given balance returned.
         */
        IdentityCleared: PlainDescriptor<Anonymize<Iep1lmt6q3s6r3>>;
        /**
         * A name was removed and the given balance slashed.
         */
        IdentityKilled: PlainDescriptor<Anonymize<Iep1lmt6q3s6r3>>;
        /**
         * A judgement was asked from a registrar.
         */
        JudgementRequested: PlainDescriptor<Anonymize<I1fac16213rie2>>;
        /**
         * A judgement request was retracted.
         */
        JudgementUnrequested: PlainDescriptor<Anonymize<I1fac16213rie2>>;
        /**
         * A judgement was given by a registrar.
         */
        JudgementGiven: PlainDescriptor<Anonymize<Ifjt77oc391o43>>;
        /**
         * A registrar was added.
         */
        RegistrarAdded: PlainDescriptor<Anonymize<Itvt1jsipv0lc>>;
        /**
         * A sub-identity was added to an identity and the deposit paid.
         */
        SubIdentityAdded: PlainDescriptor<Anonymize<Ick3mveut33f44>>;
        /**
         * An account's sub-identities were set (in bulk).
         */
        SubIdentitiesSet: PlainDescriptor<Anonymize<I719lqkkbtikbl>>;
        /**
         * A given sub-account's associated name was changed by its super-identity.
         */
        SubIdentityRenamed: PlainDescriptor<Anonymize<Ie4intrc3n8jfu>>;
        /**
         * A sub-identity was removed from an identity and the deposit freed.
         */
        SubIdentityRemoved: PlainDescriptor<Anonymize<Ick3mveut33f44>>;
        /**
         * A sub-identity was cleared, and the given deposit repatriated from the
         * main identity account to the sub-identity account.
         */
        SubIdentityRevoked: PlainDescriptor<Anonymize<Ick3mveut33f44>>;
        /**
         * A username authority was added.
         */
        AuthorityAdded: PlainDescriptor<Anonymize<I2rg5btjrsqec0>>;
        /**
         * A username authority was removed.
         */
        AuthorityRemoved: PlainDescriptor<Anonymize<I2rg5btjrsqec0>>;
        /**
         * A username was set for `who`.
         */
        UsernameSet: PlainDescriptor<Anonymize<Ibdqerrooruuq9>>;
        /**
         * A username was queued, but `who` must accept it prior to `expiration`.
         */
        UsernameQueued: PlainDescriptor<Anonymize<I8u2ba9jeiu6q0>>;
        /**
         * A queued username passed its expiration without being claimed and was removed.
         */
        PreapprovalExpired: PlainDescriptor<Anonymize<I7ieadb293k6b4>>;
        /**
         * A username was set as a primary and can be looked up from `who`.
         */
        PrimaryUsernameSet: PlainDescriptor<Anonymize<Ibdqerrooruuq9>>;
        /**
         * A dangling username (as in, a username corresponding to an account that has removed its
         * identity) has been removed.
         */
        DanglingUsernameRemoved: PlainDescriptor<Anonymize<Ibdqerrooruuq9>>;
        /**
         * A username has been unbound.
         */
        UsernameUnbound: PlainDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * A username has been removed.
         */
        UsernameRemoved: PlainDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * A username has been killed.
         */
        UsernameKilled: PlainDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * A username has been reported.
         */
        UsernameReported: PlainDescriptor<Anonymize<I86ooiomatht8n>>;
        /**
         * An identity for a person has been set.
         */
        PersonalIdentitySet: PlainDescriptor<Anonymize<I7v1eea9s3tjf6>>;
        /**
         * Evidence for a credential has beed submitted by a person.
         */
        EvidenceSubmitted: PlainDescriptor<Anonymize<Ifcon2ngg4leli>>;
        /**
         * A credential was accepted for a person.
         */
        CredentialAccepted: PlainDescriptor<Anonymize<Ifcon2ngg4leli>>;
        /**
         * A credential was rejected for a person.
         */
        CredentialRejected: PlainDescriptor<Anonymize<Ifcon2ngg4leli>>;
        /**
         * Person was banned for sending contemptuous evidence.
         */
        PersonBanned: PlainDescriptor<Anonymize<Ifcon2ngg4leli>>;
        /**
         * A personal identity was cleared.
         */
        PersonalIdentityCleared: PlainDescriptor<Anonymize<Ifcon2ngg4leli>>;
        /**
         * A reported username was judged valid.
         */
        ReportedUsernameJudgedValid: PlainDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * A reported username was judged invalid.
         */
        ReportedUsernameJudgedInvalid: PlainDescriptor<Anonymize<Ie5l999tf7t2te>>;
        /**
         * The judgment regarding a reported username was unclear or uncertain.
         */
        ReportedUsernameWeakOrUnclearJudgement: PlainDescriptor<Anonymize<I7luomlm0cts8l>>;
    };
    People: {
        /**
         * An individual has had their personhood recognised and indexed.
         */
        PersonhoodRecognized: PlainDescriptor<Anonymize<I53pb13fh9bdtb>>;
        /**
         * An individual has had their personhood recognised again and indexed.
         */
        PersonOnboarding: PlainDescriptor<Anonymize<I53pb13fh9bdtb>>;
        /**
         * A call was dispatched under an alias.
         */
        AliasDispatched: PlainDescriptor<Anonymize<I5eoknm3d4b0hp>>;
        /**
         * An alias-to-account mapping was set or updated.
         */
        AliasAccountSet: PlainDescriptor<Anonymize<I5eoknm3d4b0hp>>;
        /**
         * An alias-to-account mapping was removed.
         */
        AliasAccountUnset: PlainDescriptor<Anonymize<I5eoknm3d4b0hp>>;
        /**
         * A personal ID-to-account mapping was set or updated.
         */
        PersonalIdAccountSet: PlainDescriptor<Anonymize<I1267r4okm030g>>;
        /**
         * A personal ID-to-account mapping was removed.
         */
        PersonalIdAccountUnset: PlainDescriptor<Anonymize<I1267r4okm030g>>;
        /**
         * The people collection was created.
         */
        CollectionCreated: PlainDescriptor<undefined>;
        /**
         * Personhood was forcefully recognized by root.
         */
        ForcePersonhoodRecognized: PlainDescriptor<Anonymize<I6tuqjmsr5ahcq>>;
        /**
         * An alias-to-account mapping was cleaned up.
         */
        AliasCleanedUp: PlainDescriptor<Anonymize<I5eoknm3d4b0hp>>;
    };
    MobRule: {
        /**
         * A case has been created.
         */
        CaseCreated: PlainDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
         * A callback was triggered from mob-rule.
         */
        Callback: PlainDescriptor<Anonymize<Iff4dsuaudcmul>>;
        /**
         * There was a codec error when trying to execute the callback.
         */
        CallbackError: PlainDescriptor<undefined>;
        /**
         * The case has been closed with the following result.
         */
        CaseClosed: PlainDescriptor<Anonymize<Ibi23t489qjaej>>;
        /**
         * A vote has been placed on a case.
         */
        Voted: PlainDescriptor<Anonymize<I7v53d8lg25u6e>>;
        /**
         * A vote has been cleaned.
         */
        VoteCleaned: PlainDescriptor<Anonymize<Ic01glfot2319>>;
        /**
         * A case has been removed.
         */
        CaseRemoved: PlainDescriptor<Anonymize<Id1vp19i5a7adv>>;
        /**
         * A case has been intervened.
         */
        CaseIntervened: PlainDescriptor<Anonymize<Ibi23t489qjaej>>;
        /**
         * Credits for votes have been claimed.
         */
        VotesClaimed: PlainDescriptor<Anonymize<Ie732hi40q3bng>>;
        /**
         * A reward that has been paid out.
         */
        RewardPayout: PlainDescriptor<Anonymize<I4auq2rk2vmnof>>;
        /**
         * A new payout round has been started.
         */
        PayoutRoundStarted: PlainDescriptor<Anonymize<I36d2sa03ne4gv>>;
        /**
         * Payout rounds have been scheduled.
         */
        PayoutRoundsScheduled: PlainDescriptor<Anonymize<I1c6o7t4005obp>>;
        /**
         * A payout schedule has been removed.
         */
        PayoutScheduleRemoved: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
         * Credit has been claimed from the payout distribution.
         */
        CreditClaimed: PlainDescriptor<Anonymize<Id0mmcnagcakpt>>;
        /**
         * Stale voting points have been cleaned.
         */
        PointsCleaned: PlainDescriptor<Anonymize<I3sgg3ifcuhgsi>>;
        /**
         * A case has been touched (re-evaluated).
         */
        CaseTouched: PlainDescriptor<Anonymize<I3fn79iu085nho>>;
        /**
         * A voting penalty has been cleared.
         */
        VotingPenaltyCleared: PlainDescriptor<Anonymize<I1qepegjhn0439>>;
    };
    ProofOfInk: {
        /**
         * Candidate applied for verification.
         */
        CandidateApplied: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * Candidate opened a judicial case for their verification evidence.
         */
        JudgementRequested: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * Oracle has provided the judgement for a judicial case.
         */
        JudgementProvided: PlainDescriptor<Anonymize<I3g1h0napekm89>>;
        /**
         * A candidate has been granted a free retry attempt after a failure to verify their
         * evidence.
         */
        RetryGranted: PlainDescriptor<Anonymize<Ib4r095rdf5mqu>>;
        /**
         * Register an account as a person.
         */
        PersonRegistered: PlainDescriptor<Anonymize<I816g8dafh3n9m>>;
        /**
         * Person referred an account.
         */
        CandidateReferred: PlainDescriptor<Anonymize<I5rguq5hs7ae5g>>;
        /**
         * Entropy for a candidate changed after expiry.
         */
        Rerolled: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * Candidate committed to an ink design.
         */
        DesignCommitted: PlainDescriptor<Anonymize<Id0n15ml7mlce1>>;
        /**
         * Storage fully allocated for a committed design.
         */
        FullyAllocated: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * Candidate removed after timeout.
         */
        TimedOut: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * Uncommitted candidate removed.
         */
        FlakedOut: PlainDescriptor<Anonymize<I6v8sm60vvkmk7>>;
        /**
         * Referral ticket created by storing the public key on chain.
         */
        TicketReferred: PlainDescriptor<Anonymize<I95dvhl27mlrti>>;
        /**
         * Referral ticket removed by removing the public key from chain storage.
         */
        TicketCancelled: PlainDescriptor<Anonymize<I95dvhl27mlrti>>;
        /**
         * Candidate applied using a referral ticket.
         */
        TicketApplied: PlainDescriptor<Anonymize<I6mojmjujt2q9u>>;
        /**
         * Design family added.
         */
        FamilyAdded: PlainDescriptor<Anonymize<Idnsos6tvi9tt6>>;
        /**
         * All invites have been removed for the inviter.
         */
        AllInvitesRemoved: PlainDescriptor<Anonymize<I3j43dj5855fif>>;
        /**
         * Some invites have been removed for the inviter, some are remaining.
         */
        SomeInvitesRemoved: PlainDescriptor<Anonymize<I3j43dj5855fif>>;
        /**
         * Candidate applied using an invitation.
         */
        InvitedCandidateApplied: PlainDescriptor<Anonymize<I9m7e67l1rvair>>;
        /**
         * A referrer's reward voucher has been registered.
         */
        ReferralVoucherRegistered: PlainDescriptor<Anonymize<I2fsu027d9jn8p>>;
        /**
         * Invites have been granted to an account.
         */
        InvitesGranted: PlainDescriptor<Anonymize<Ibl1gaa0rn2c67>>;
        /**
         * An invite ticket has been set.
         */
        InviteTicketSet: PlainDescriptor<Anonymize<I1858d79avs8nu>>;
        /**
         * An invite ticket has been cancelled.
         */
        InviteTicketCancelled: PlainDescriptor<Anonymize<I1858d79avs8nu>>;
        /**
         * The pallet configuration has been updated.
         */
        ConfigurationSet: PlainDescriptor<Anonymize<I4s48t49obgv40>>;
    };
    Game: {
        /**
         * A new game is starting.
         */
        NewGame: PlainDescriptor<Anonymize<I4dge44jia159s>>;
        /**
         * The game and its post-process has ended.
         */
        GameEnded: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
         * The current game was force-killed by [`Config::ManagerOrigin`].
         */
        GameKilled: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
         * The game phase durations were overridden by [`Config::ManagerOrigin`].
         */
        GamePhasesSet: PlainDescriptor<Anonymize<I7rcbn8l002fcc>>;
        /**
         * A player signed up for the game.
         */
        SignedUp: PlainDescriptor<Anonymize<I7uvflbq4g7rn>>;
        /**
         * A player submitted their report.
         */
        ReportSubmitted: PlainDescriptor<Anonymize<Icpl0grufrj09l>>;
        /**
         * A player offboarded from the game.
         */
        Offboarded: PlainDescriptor<Anonymize<I7uvflbq4g7rn>>;
        /**
         * An archived player was kicked out.
         */
        KickedOut: PlainDescriptor<Anonymize<Ibi26id9j1t520>>;
        /**
         * Invites were granted to an account.
         */
        InvitesGranted: PlainDescriptor<Anonymize<Ibl1gaa0rn2c67>>;
        /**
         * An invite ticket was set.
         */
        InviteTicketSet: PlainDescriptor<Anonymize<I3j43dj5855fif>>;
        /**
         * An invite ticket was cancelled.
         */
        InviteTicketCancelled: PlainDescriptor<Anonymize<I3j43dj5855fif>>;
        /**
         * Games were scheduled.
         */
        GamesScheduled: PlainDescriptor<Anonymize<Iafscmv8tjf0ou>>;
        /**
         * A scheduled game was removed.
         */
        ScheduledGameRemoved: PlainDescriptor<Anonymize<Ic9lb0ksm6bqp9>>;
        /**
         * Statement store usage removed for the account.
         */
        StmtUsageRemoved: PlainDescriptor<Anonymize<I1qepegjhn0439>>;
        /**
         * All invites have been removed for the inviter.
         */
        AllInvitesRemoved: PlainDescriptor<Anonymize<I3j43dj5855fif>>;
        /**
         * Some invites have been removed for the inviter, some are remaining.
         */
        SomeInvitesRemoved: PlainDescriptor<Anonymize<I3j43dj5855fif>>;
        /**
         * The configured play deposit was updated.
         */
        PlayDepositSet: PlainDescriptor<Anonymize<I3qt1hgg4djhgb>>;
        /**
         * An airdrop event was scheduled for the current game.
         */
        AirdropScheduled: PlainDescriptor<Anonymize<Irboug90jv3o0>>;
        /**
         * The airdrop event for the current game failed to schedule.
         */
        AirdropScheduleFailed: PlainDescriptor<Anonymize<I33d7cg3ci0742>>;
        /**
         * Game `game_index` was cancelled.
         */
        GameCancelled: PlainDescriptor<Anonymize<I8s2eo7q9t6vgf>>;
    };
    Score: {
        /**
         * A person has claimed credit.
         */
        CreditClaimed: PlainDescriptor<Anonymize<Ieitag1fl7hkds>>;
        /**
         * Personhood was recognized for an account.
         */
        PersonhoodRecognized: PlainDescriptor<Anonymize<Ie060ubkeme5vs>>;
        /**
         * Payout rounds have been scheduled.
         */
        PayoutRoundsScheduled: PlainDescriptor<Anonymize<Icpk5dvoekngbe>>;
        /**
         * A payout schedule has been removed.
         */
        PayoutScheduleRemoved: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
         * A round has been transitioned.
         */
        RoundTransitioned: PlainDescriptor<Anonymize<Iepoo00jurbs3c>>;
        /**
         * A payout round has been operated (credit distributed to participants).
         */
        PayoutRoundOperated: PlainDescriptor<Anonymize<Iepoo00jurbs3c>>;
        /**
         * A participant has cashed out score for points.
         */
        CashedOut: PlainDescriptor<Anonymize<I7uvflbq4g7rn>>;
        /**
         * The personhood-threshold schedule has been set.
         */
        PersonhoodThresholdScheduleSet: PlainDescriptor<undefined>;
        /**
         * The absence-grace schedule has been set.
         */
        AbsenceGraceScheduleSet: PlainDescriptor<undefined>;
    };
    DummyDim: {
        /**
         * A number of IDs was reserved.
         */
        IdsReserved: PlainDescriptor<Anonymize<Iafscmv8tjf0ou>>;
        /**
         * An ID was renewed.
         */
        IdRenewed: PlainDescriptor<Anonymize<I4ov6e94l79mbg>>;
        /**
         * A reserved ID was removed.
         */
        IdUnreserved: PlainDescriptor<Anonymize<I4ov6e94l79mbg>>;
        /**
         * Register multiple people.
         */
        PeopleRegistered: PlainDescriptor<Anonymize<Iafscmv8tjf0ou>>;
        /**
         * Suspend a number of people.
         */
        PeopleSuspended: PlainDescriptor<Anonymize<Iafscmv8tjf0ou>>;
        /**
         * Someone's personhood was resumed.
         */
        PersonhoodResumed: PlainDescriptor<Anonymize<I4ov6e94l79mbg>>;
        /**
         * The pallet enabled suspensions.
         */
        SuspensionsStarted: PlainDescriptor<undefined>;
        /**
         * The pallet disabled suspensions.
         */
        SuspensionsEnded: PlainDescriptor<undefined>;
    };
    PeopleLite: {
        /**
         * All attestation allowance has been removed for the verifier.
         */
        AllAttestationAllowanceCleared: PlainDescriptor<Anonymize<I58bu3hm7657hm>>;
        /**
         * Attestation allowance was increased for an account by `count` attestations.
         */
        AttestationAllowanceIncreased: PlainDescriptor<Anonymize<Ibl1gaa0rn2c67>>;
        /**
         * A new lite person was registered through attestation.
         */
        PersonAttested: PlainDescriptor<Anonymize<Icc0fkkhtd78sc>>;
        /**
         * A lite person was registered as a consumer.
         */
        ConsumerRegistered: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * An alias-to-account mapping was set or updated.
         */
        AliasAccountSet: PlainDescriptor<Anonymize<I5eoknm3d4b0hp>>;
        /**
         * An alias-to-account mapping was removed.
         */
        AliasAccountUnset: PlainDescriptor<Anonymize<I5eoknm3d4b0hp>>;
    };
    Resources: {
        /**
         * A person has registered as a consumer.
         */
        PersonRegistered: PlainDescriptor<Anonymize<I9vf1so75dnrom>>;
        /**
         * A lite person has registered as a consumer.
         */
        LitePersonRegistered: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * Friend request statement usage has been assigned for a sequence.
         */
        FriendRequestStmtUsageSet: PlainDescriptor<Anonymize<I9hg8vptgbqai>>;
        /**
         * Friend request statement usage has been removed.
         */
        FriendRequestStmtUsageRemoved: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * A person's authorization was touched.
         */
        PersonAuthorizationTouched: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * An expired username reservation was removed.
         */
        ExpiredUsernameReservationRemoved: PlainDescriptor<Anonymize<I28tfrqrmts741>>;
        /**
         * A consumer's identifier key was updated.
         */
        IdentifierKeyUpdated: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * The username reservation duration was set.
         */
        UsernameReservationDurationSet: PlainDescriptor<Anonymize<I1i6t85s8phv1c>>;
        /**
         * An anonymous statement store allowance was granted.
         */
        StmtStoreAllowanceSet: PlainDescriptor<Anonymize<I9hg8vptgbqai>>;
        /**
         * Expired statement store allowances were cleaned up.
         */
        StmtStoreAllowancesCleared: PlainDescriptor<Anonymize<I16m4f7hclkkad>>;
        /**
         * A full person was demoted due to expired authorization.
         */
        PersonDemoted: PlainDescriptor<Anonymize<Icbccs0ug47ilf>>;
        /**
         * Long-term storage has been claimed for an account.
         */
        LongTermStorageClaimed: PlainDescriptor<Anonymize<I5dvnb65dm4f56>>;
        /**
         * A long-term storage claim was accepted but the downstream allocation failed. The alias
         * is still marked spent for the period.
         */
        LongTermStorageAllocationFailed: PlainDescriptor<Anonymize<I5dvnb65dm4f56>>;
        /**
         * Expired long-term storage aliases have been cleared for a period.
         */
        LongTermStorageAliasesCleared: PlainDescriptor<Anonymize<I2abip8j5bmg27>>;
    };
    ChunksManager: {
        /**
         * A new chunk page hash set has been initialized (e.g., during genesis).
         */
        ChunkPageHashesInitialized: PlainDescriptor<Anonymize<Ickpn0png35631>>;
        /**
         * New chunks have been successfully added to an existing or new chunk set.
         */
        ChunksAdded: PlainDescriptor<Anonymize<I3ns5kg6jo268n>>;
    };
    Members: {
        /**
         * An entity has had their membership recognised and indexed.
         */
        MemberAdded: PlainDescriptor<Anonymize<I7hu7hl7r35nrm>>;
        /**
         * An entity has had their membership revoked.
         */
        MemberRemoved: PlainDescriptor<Anonymize<I7hu7hl7r35nrm>>;
        /**
         * A collection has been marked for deletion.
         */
        CollectionMarkedForDeletion: PlainDescriptor<Anonymize<Idjiu7vp8ovdab>>;
        /**
         * A collection has been fully deleted.
         */
        CollectionDeleted: PlainDescriptor<Anonymize<Idjiu7vp8ovdab>>;
        /**
         * A ring root was built.
         */
        RingBuilt: PlainDescriptor<Anonymize<Idpufnltgsuodp>>;
        /**
         * Members were onboarded.
         */
        MembersOnboarded: PlainDescriptor<Anonymize<Idjiu7vp8ovdab>>;
        /**
         * Two rings were merged.
         */
        RingsMerged: PlainDescriptor<Anonymize<I6mk90q9np5nf3>>;
        /**
         * The onboarding size was set for a collection.
         */
        OnboardingSizeSet: PlainDescriptor<Anonymize<Ichkkipipv6vbf>>;
        /**
         * A member self-included into a ring.
         */
        MemberSelfIncluded: PlainDescriptor<Anonymize<Ia783as0f2ls27>>;
        /**
         * An old root revision has been cleaned up.
         */
        OldRootCleanedUp: PlainDescriptor<Anonymize<I298u2lqese6h0>>;
    };
    Coinage: {
        /**
        
         */
        CoinSplit: PlainDescriptor<Anonymize<I4c20l83g9496a>>;
        /**
        
         */
        CoinTransferred: PlainDescriptor<Anonymize<I4gp88defd7an>>;
        /**
        
         */
        RecyclerLoadedWithCoin: PlainDescriptor<Anonymize<Icnkee0to4c5ac>>;
        /**
        
         */
        RecyclerLoadedWithExternalAsset: PlainDescriptor<Anonymize<Id113tpicu8sh3>>;
        /**
        
         */
        RecyclerUnloadedIntoCoin: PlainDescriptor<Anonymize<I6ceb7pmur4hki>>;
        /**
        
         */
        RecyclerUnloadedIntoExternalAsset: PlainDescriptor<Anonymize<Ie2d9d2u1qa7ro>>;
        /**
        
         */
        RecyclerUnloadedIntoExternalAssetAndVouchers: PlainDescriptor<Anonymize<Iebdi09jg1ifvr>>;
        /**
        
         */
        PaidUnloadTokenRegisteredWithCoin: PlainDescriptor<Anonymize<I5kek6hgenovr0>>;
        /**
        
         */
        PaidUnloadTokenRegisteredWithNative: PlainDescriptor<Anonymize<I91tbphb2dk7gn>>;
        /**
        
         */
        PaidUnloadTokenRegisteredWithStable: PlainDescriptor<Anonymize<I91tbphb2dk7gn>>;
        /**
        
         */
        PeopleFreeUnloadTokenConsumed: PlainDescriptor<Anonymize<I7ts20td7b1pmf>>;
        /**
        
         */
        LitePeopleFreeUnloadTokenConsumed: PlainDescriptor<Anonymize<I7ts20td7b1pmf>>;
        /**
        
         */
        RecyclersUnloadedIntoCoin: PlainDescriptor<Anonymize<I5509mqtnio180>>;
        /**
        
         */
        RecyclersUnloadedIntoExternalAsset: PlainDescriptor<Anonymize<Ifojd05k7ogo8n>>;
        /**
        
         */
        RecyclersUnloadedIntoExternalAssetNonAnonymous: PlainDescriptor<Anonymize<I2h93i19beq4qk>>;
        /**
        
         */
        RecyclerUnloadedIntoCoins: PlainDescriptor<Anonymize<I4c20l83g9496a>>;
        /**
        
         */
        CoinOffboardedIntoExternalAsset: PlainDescriptor<Anonymize<I4lmgf1qe39res>>;
        /**
        
         */
        RecyclerCleaned: PlainDescriptor<Anonymize<Igvk3mrc51o9l>>;
        /**
        
         */
        ConsumedFreeTokensCleaned: PlainDescriptor<Anonymize<I7ts20td7b1pmf>>;
        /**
        
         */
        PaidUnloadTokenRingCleaned: PlainDescriptor<Anonymize<I7315hlp5liq47>>;
        /**
        
         */
        RecyclerDustCleaned: PlainDescriptor<undefined>;
        /**
        
         */
        PaidUnloadTokenDustCleaned: PlainDescriptor<undefined>;
        /**
        
         */
        ExpiredPaidUnloadTokenCollectionDeleted: PlainDescriptor<Anonymize<I7ts20td7b1pmf>>;
        /**
        
         */
        UnderlyingAssetIdSet: PlainDescriptor<Anonymize<I22bm4d7re21j9>>;
    };
    MembersNotifier: {
        /**
         * A parachain subscribed.
         */
        Subscribed: PlainDescriptor<Anonymize<I37r4bdai8o9mp>>;
        /**
         * A parachain unsubscribed.
         */
        Unsubscribed: PlainDescriptor<Anonymize<I37r4bdai8o9mp>>;
        /**
         * Update batch sent to subscriber.
         */
        UpdatesSent: PlainDescriptor<Anonymize<Ifrvjscp9m1e73>>;
        /**
         * Sending ring root updates to a subscriber failed.
         */
        UpdateSendFailed: PlainDescriptor<Anonymize<I37r4bdai8o9mp>>;
        /**
         * Replay of ring roots requested by a subscriber.
         */
        ReplayRequested: PlainDescriptor<Anonymize<Iamcee9e6bogsv>>;
        /**
         * A stuck batch was abandoned by the offchain worker.
         */
        BatchAbandoned: PlainDescriptor<Anonymize<I2e1ek76m34991>>;
    };
    Airdrop: {
        /**
        
         */
        EventScheduled: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        ScheduledEventRemoved: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        EventCancelled: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        RegistrationStarted: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        AliasRegistered: PlainDescriptor<Anonymize<I50aksks5it5n0>>;
        /**
        
         */
        AccountRegistered: PlainDescriptor<Anonymize<Icc5o3lh1v2smd>>;
        /**
        
         */
        DrawingWinners: PlainDescriptor<Anonymize<I5srndmgodi29b>>;
        /**
        
         */
        ClaimingStarted: PlainDescriptor<Anonymize<I5srndmgodi29b>>;
        /**
        
         */
        EventCanceled: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        PrizeClaimed: PlainDescriptor<Anonymize<Idd6sihggmv1dq>>;
        /**
        
         */
        ClearingRegistrations: PlainDescriptor<Anonymize<I1obalebkt2h11>>;
        /**
        
         */
        ClearingWinners: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        FinalizingEvent: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        EventCompleted: PlainDescriptor<Anonymize<Ib4o08d7u3o37d>>;
        /**
        
         */
        AssetEnabled: PlainDescriptor<Anonymize<I2gbrv9jm3ucsu>>;
        /**
        
         */
        AssetDisabled: PlainDescriptor<Anonymize<I9pgrv71u9hf6c>>;
    };
    Honour: {
        /**
         * A subject was voted on with a previously unused point.
         */
        VoteCast: PlainDescriptor<Anonymize<Ib2kb4gr1v6eis>>;
        /**
         * A point was redirected from one subject to another.
         */
        VoteReused: PlainDescriptor<Anonymize<Ib52ld1ackp05u>>;
        /**
         * The honour score of a subject has changed.
         */
        HonourChanged: PlainDescriptor<Anonymize<I619o495nctj82>>;
    };
    StorageInitialization: {
        /**
         * The foreign asset was created and reserves were set.
         */
        AssetCreated: PlainDescriptor<undefined>;
        /**
         * An XCM funds transfer was sent to Asset Hub.
         */
        XcmFundsTransferSent: PlainDescriptor<undefined>;
        /**
         * The XCM transfer timed out and will be retried.
         */
        XcmFundsTransferTimedOut: PlainDescriptor<undefined>;
        /**
         * Transferred funds have been verified.
         */
        FundsVerified: PlainDescriptor<undefined>;
        /**
         * All pots have been funded.
         */
        PotsFunded: PlainDescriptor<undefined>;
        /**
         * People Lite attestation allowances have been set.
         */
        PeopleLiteAttestationAllowancesSet: PlainDescriptor<undefined>;
        /**
         * Mob Rule payout schedule has been set.
         */
        MobRulePayoutsScheduled: PlainDescriptor<undefined>;
        /**
         * Score payout schedule has been set.
         */
        ScorePayoutsScheduled: PlainDescriptor<undefined>;
        /**
         * The one-time on_poll initialization has completed.
         */
        OnPollInitializationCompleted: PlainDescriptor<undefined>;
        /**
         * Migration: initial people have been recognized.
         */
        MigrationPeopleRecognized: PlainDescriptor<undefined>;
        /**
         * Migration: onboarding size has been set.
         */
        MigrationOnboardingSizeSet: PlainDescriptor<undefined>;
        /**
         * Migration: Proof-of-Ink pallet has been initialized.
         */
        MigrationProofOfInkInitialized: PlainDescriptor<undefined>;
        /**
         * Migration: games have been scheduled.
         */
        MigrationGamesScheduled: PlainDescriptor<undefined>;
        /**
         * Migration: invites have been granted.
         */
        MigrationInvitesGranted: PlainDescriptor<undefined>;
        /**
         * Migration: Proof-of-Ink reimbursement values have been set.
         */
        MigrationReimbursementValuesSet: PlainDescriptor<undefined>;
        /**
         * Migration: People Lite attestation allowances have been set.
         */
        MigrationAttestationAllowancesSet: PlainDescriptor<undefined>;
        /**
         * Migration has completed and on_poll initialization has been triggered.
         */
        MigrationCompleted: PlainDescriptor<undefined>;
    };
    MultiBlockMigrations: {
        /**
         * A Runtime upgrade started.
         *
         * Its end is indicated by `UpgradeCompleted` or `UpgradeFailed`.
         */
        UpgradeStarted: PlainDescriptor<Anonymize<If1co0pilmi7oq>>;
        /**
         * The current runtime upgrade completed.
         *
         * This implies that all of its migrations completed successfully as well.
         */
        UpgradeCompleted: PlainDescriptor<undefined>;
        /**
         * Runtime upgrade failed.
         *
         * This is very bad and will require governance intervention.
         */
        UpgradeFailed: PlainDescriptor<undefined>;
        /**
         * A migration was skipped since it was already executed in the past.
         */
        MigrationSkipped: PlainDescriptor<Anonymize<I666bl2fqjkejo>>;
        /**
         * A migration progressed.
         */
        MigrationAdvanced: PlainDescriptor<Anonymize<Iae74gjak1qibn>>;
        /**
         * A Migration completed.
         */
        MigrationCompleted: PlainDescriptor<Anonymize<Iae74gjak1qibn>>;
        /**
         * A Migration failed.
         *
         * This implies that the whole upgrade failed and governance intervention is required.
         */
        MigrationFailed: PlainDescriptor<Anonymize<Iae74gjak1qibn>>;
        /**
         * The set of historical migrations has been cleared.
         */
        HistoricCleared: PlainDescriptor<Anonymize<I3escdojpj0551>>;
    };
};
type IError = {
    System: {
        /**
         * The name of specification does not match between the current runtime
         * and the new runtime.
         */
        InvalidSpecName: PlainDescriptor<undefined>;
        /**
         * The specification version is not allowed to decrease between the current runtime
         * and the new runtime.
         */
        SpecVersionNeedsToIncrease: PlainDescriptor<undefined>;
        /**
         * Failed to extract the runtime version from the new runtime.
         *
         * Either calling `Core_version` or decoding `RuntimeVersion` failed.
         */
        FailedToExtractRuntimeVersion: PlainDescriptor<undefined>;
        /**
         * Suicide called when the account has non-default composite data.
         */
        NonDefaultComposite: PlainDescriptor<undefined>;
        /**
         * There is a non-zero reference count preventing the account from being purged.
         */
        NonZeroRefCount: PlainDescriptor<undefined>;
        /**
         * The origin filter prevent the call to be dispatched.
         */
        CallFiltered: PlainDescriptor<undefined>;
        /**
         * A multi-block migration is ongoing and prevents the current code from being replaced.
         */
        MultiBlockMigrationsOngoing: PlainDescriptor<undefined>;
        /**
         * No upgrade authorized.
         */
        NothingAuthorized: PlainDescriptor<undefined>;
        /**
         * The submitted code is not authorized.
         */
        Unauthorized: PlainDescriptor<undefined>;
    };
    ParachainSystem: {
        /**
         * Attempt to upgrade validation function while existing upgrade pending.
         */
        OverlappingUpgrades: PlainDescriptor<undefined>;
        /**
         * Polkadot currently prohibits this parachain from upgrading its validation function.
         */
        ProhibitedByPolkadot: PlainDescriptor<undefined>;
        /**
         * The supplied validation function has compiled into a blob larger than Polkadot is
         * willing to run.
         */
        TooBig: PlainDescriptor<undefined>;
        /**
         * The inherent which supplies the validation data did not run this block.
         */
        ValidationDataNotAvailable: PlainDescriptor<undefined>;
        /**
         * The inherent which supplies the host configuration did not run this block.
         */
        HostConfigurationNotAvailable: PlainDescriptor<undefined>;
        /**
         * No validation function upgrade is currently scheduled.
         */
        NotScheduled: PlainDescriptor<undefined>;
    };
    Balances: {
        /**
         * Vesting balance too high to send value.
         */
        VestingBalance: PlainDescriptor<undefined>;
        /**
         * Account liquidity restrictions prevent withdrawal.
         */
        LiquidityRestrictions: PlainDescriptor<undefined>;
        /**
         * Balance too low to send value.
         */
        InsufficientBalance: PlainDescriptor<undefined>;
        /**
         * Value too low to create account due to existential deposit.
         */
        ExistentialDeposit: PlainDescriptor<undefined>;
        /**
         * Transfer/payment would kill account.
         */
        Expendability: PlainDescriptor<undefined>;
        /**
         * A vesting schedule already exists for this account.
         */
        ExistingVestingSchedule: PlainDescriptor<undefined>;
        /**
         * Beneficiary account must pre-exist.
         */
        DeadAccount: PlainDescriptor<undefined>;
        /**
         * Number of named reserves exceed `MaxReserves`.
         */
        TooManyReserves: PlainDescriptor<undefined>;
        /**
         * Number of holds exceed `VariantCountOf<T::RuntimeHoldReason>`.
         */
        TooManyHolds: PlainDescriptor<undefined>;
        /**
         * Number of freezes exceed `MaxFreezes`.
         */
        TooManyFreezes: PlainDescriptor<undefined>;
        /**
         * The issuance cannot be modified since it is already deactivated.
         */
        IssuanceDeactivated: PlainDescriptor<undefined>;
        /**
         * The delta cannot be zero.
         */
        DeltaZero: PlainDescriptor<undefined>;
    };
    OriginRestriction: {
        /**
         * The origin has no usage tracked.
         */
        NoUsage: PlainDescriptor<undefined>;
        /**
         * The usage is not zero.
         */
        NotZero: PlainDescriptor<undefined>;
    };
    Assets: {
        /**
         * Account balance must be greater than or equal to the transfer amount.
         */
        BalanceLow: PlainDescriptor<undefined>;
        /**
         * The account to alter does not exist.
         */
        NoAccount: PlainDescriptor<undefined>;
        /**
         * The signing account has no permission to do the operation.
         */
        NoPermission: PlainDescriptor<undefined>;
        /**
         * The given asset ID is unknown.
         */
        Unknown: PlainDescriptor<undefined>;
        /**
         * The origin account is frozen.
         */
        Frozen: PlainDescriptor<undefined>;
        /**
         * The asset ID is already taken.
         */
        InUse: PlainDescriptor<undefined>;
        /**
         * Invalid witness data given.
         */
        BadWitness: PlainDescriptor<undefined>;
        /**
         * Minimum balance should be non-zero.
         */
        MinBalanceZero: PlainDescriptor<undefined>;
        /**
         * Unable to increment the consumer reference counters on the account. Either no provider
         * reference exists to allow a non-zero balance of a non-self-sufficient asset, or one
         * fewer then the maximum number of consumers has been reached.
         */
        UnavailableConsumer: PlainDescriptor<undefined>;
        /**
         * Invalid metadata given.
         */
        BadMetadata: PlainDescriptor<undefined>;
        /**
         * No approval exists that would allow the transfer.
         */
        Unapproved: PlainDescriptor<undefined>;
        /**
         * The source account would not survive the transfer and it needs to stay alive.
         */
        WouldDie: PlainDescriptor<undefined>;
        /**
         * The asset-account already exists.
         */
        AlreadyExists: PlainDescriptor<undefined>;
        /**
         * The asset-account doesn't have an associated deposit.
         */
        NoDeposit: PlainDescriptor<undefined>;
        /**
         * The operation would result in funds being burned.
         */
        WouldBurn: PlainDescriptor<undefined>;
        /**
         * The asset is a live asset and is actively being used. Usually emit for operations such
         * as `start_destroy` which require the asset to be in a destroying state.
         */
        LiveAsset: PlainDescriptor<undefined>;
        /**
         * The asset is not live, and likely being destroyed.
         */
        AssetNotLive: PlainDescriptor<undefined>;
        /**
         * The asset status is not the expected status.
         */
        IncorrectStatus: PlainDescriptor<undefined>;
        /**
         * The asset should be frozen before the given operation.
         */
        NotFrozen: PlainDescriptor<undefined>;
        /**
         * Callback action resulted in error
         */
        CallbackFailed: PlainDescriptor<undefined>;
        /**
         * The asset ID must be equal to the [`NextAssetId`].
         */
        BadAssetId: PlainDescriptor<undefined>;
        /**
         * The asset cannot be destroyed because some accounts for this asset contain freezes.
         */
        ContainsFreezes: PlainDescriptor<undefined>;
        /**
         * The asset cannot be destroyed because some accounts for this asset contain holds.
         */
        ContainsHolds: PlainDescriptor<undefined>;
        /**
         * Tried setting too many reserves.
         */
        TooManyReserves: PlainDescriptor<undefined>;
    };
    AssetsHolder: {
        /**
         * Number of holds on an account would exceed the count of `RuntimeHoldReason`.
         */
        TooManyHolds: PlainDescriptor<undefined>;
    };
    AssetRate: {
        /**
         * The given asset ID is unknown.
         */
        UnknownAssetKind: PlainDescriptor<undefined>;
        /**
         * The given asset ID already has an assigned conversion rate and cannot be re-created.
         */
        AlreadyExists: PlainDescriptor<undefined>;
        /**
         * Overflow ocurred when calculating the inverse rate.
         */
        Overflow: PlainDescriptor<undefined>;
    };
    CollatorSelection: {
        /**
         * The pallet has too many candidates.
         */
        TooManyCandidates: PlainDescriptor<undefined>;
        /**
         * Leaving would result in too few candidates.
         */
        TooFewEligibleCollators: PlainDescriptor<undefined>;
        /**
         * Account is already a candidate.
         */
        AlreadyCandidate: PlainDescriptor<undefined>;
        /**
         * Account is not a candidate.
         */
        NotCandidate: PlainDescriptor<undefined>;
        /**
         * There are too many Invulnerables.
         */
        TooManyInvulnerables: PlainDescriptor<undefined>;
        /**
         * Account is already an Invulnerable.
         */
        AlreadyInvulnerable: PlainDescriptor<undefined>;
        /**
         * Account is not an Invulnerable.
         */
        NotInvulnerable: PlainDescriptor<undefined>;
        /**
         * Account has no associated validator ID.
         */
        NoAssociatedValidatorId: PlainDescriptor<undefined>;
        /**
         * Validator ID is not yet registered.
         */
        ValidatorNotRegistered: PlainDescriptor<undefined>;
        /**
         * Could not insert in the candidate list.
         */
        InsertToCandidateListFailed: PlainDescriptor<undefined>;
        /**
         * Could not remove from the candidate list.
         */
        RemoveFromCandidateListFailed: PlainDescriptor<undefined>;
        /**
         * New deposit amount would be below the minimum candidacy bond.
         */
        DepositTooLow: PlainDescriptor<undefined>;
        /**
         * Could not update the candidate list.
         */
        UpdateCandidateListFailed: PlainDescriptor<undefined>;
        /**
         * Deposit amount is too low to take the target's slot in the candidate list.
         */
        InsufficientBond: PlainDescriptor<undefined>;
        /**
         * The target account to be replaced in the candidate list is not a candidate.
         */
        TargetIsNotCandidate: PlainDescriptor<undefined>;
        /**
         * The updated deposit amount is equal to the amount already reserved.
         */
        IdenticalDeposit: PlainDescriptor<undefined>;
        /**
         * Cannot lower candidacy bond while occupying a future collator slot in the list.
         */
        InvalidUnreserve: PlainDescriptor<undefined>;
    };
    Session: {
        /**
         * Invalid ownership proof.
         */
        InvalidProof: PlainDescriptor<undefined>;
        /**
         * No associated validator ID for account.
         */
        NoAssociatedValidatorId: PlainDescriptor<undefined>;
        /**
         * Registered duplicate key.
         */
        DuplicatedKey: PlainDescriptor<undefined>;
        /**
         * No keys are associated with this account.
         */
        NoKeys: PlainDescriptor<undefined>;
        /**
         * Key setting account is not live, so it's impossible to associate keys.
         */
        NoAccount: PlainDescriptor<undefined>;
    };
    XcmpQueue: {
        /**
         * Setting the queue config failed since one of its values was invalid.
         */
        BadQueueConfig: PlainDescriptor<undefined>;
        /**
         * The execution is already suspended.
         */
        AlreadySuspended: PlainDescriptor<undefined>;
        /**
         * The execution is already resumed.
         */
        AlreadyResumed: PlainDescriptor<undefined>;
        /**
         * There are too many active outbound channels.
         */
        TooManyActiveOutboundChannels: PlainDescriptor<undefined>;
        /**
         * The message is too big.
         */
        TooBig: PlainDescriptor<undefined>;
    };
    PolkadotXcm: {
        /**
         * The desired destination was unreachable, generally because there is a no way of routing
         * to it.
         */
        Unreachable: PlainDescriptor<undefined>;
        /**
         * There was some other issue (i.e. not to do with routing) in sending the message.
         * Perhaps a lack of space for buffering the message.
         */
        SendFailure: PlainDescriptor<undefined>;
        /**
         * The message execution fails the filter.
         */
        Filtered: PlainDescriptor<undefined>;
        /**
         * The message's weight could not be determined.
         */
        UnweighableMessage: PlainDescriptor<undefined>;
        /**
         * The destination `Location` provided cannot be inverted.
         */
        DestinationNotInvertible: PlainDescriptor<undefined>;
        /**
         * The assets to be sent are empty.
         */
        Empty: PlainDescriptor<undefined>;
        /**
         * Could not re-anchor the assets to declare the fees for the destination chain.
         */
        CannotReanchor: PlainDescriptor<undefined>;
        /**
         * Too many assets have been attempted for transfer.
         */
        TooManyAssets: PlainDescriptor<undefined>;
        /**
         * Origin is invalid for sending.
         */
        InvalidOrigin: PlainDescriptor<undefined>;
        /**
         * The version of the `Versioned` value used is not able to be interpreted.
         */
        BadVersion: PlainDescriptor<undefined>;
        /**
         * The given location could not be used (e.g. because it cannot be expressed in the
         * desired version of XCM).
         */
        BadLocation: PlainDescriptor<undefined>;
        /**
         * The referenced subscription could not be found.
         */
        NoSubscription: PlainDescriptor<undefined>;
        /**
         * The location is invalid since it already has a subscription from us.
         */
        AlreadySubscribed: PlainDescriptor<undefined>;
        /**
         * Could not check-out the assets for teleportation to the destination chain.
         */
        CannotCheckOutTeleport: PlainDescriptor<undefined>;
        /**
         * The owner does not own (all) of the asset that they wish to do the operation on.
         */
        LowBalance: PlainDescriptor<undefined>;
        /**
         * The asset owner has too many locks on the asset.
         */
        TooManyLocks: PlainDescriptor<undefined>;
        /**
         * The given account is not an identifiable sovereign account for any location.
         */
        AccountNotSovereign: PlainDescriptor<undefined>;
        /**
         * The operation required fees to be paid which the initiator could not meet.
         */
        FeesNotMet: PlainDescriptor<undefined>;
        /**
         * A remote lock with the corresponding data could not be found.
         */
        LockNotFound: PlainDescriptor<undefined>;
        /**
         * The unlock operation cannot succeed because there are still consumers of the lock.
         */
        InUse: PlainDescriptor<undefined>;
        /**
         * Invalid asset, reserve chain could not be determined for it.
         */
        InvalidAssetUnknownReserve: PlainDescriptor<undefined>;
        /**
         * Invalid asset, do not support remote asset reserves with different fees reserves.
         */
        InvalidAssetUnsupportedReserve: PlainDescriptor<undefined>;
        /**
         * Too many assets with different reserve locations have been attempted for transfer.
         */
        TooManyReserves: PlainDescriptor<undefined>;
        /**
         * Local XCM execution incomplete.
         */
        LocalExecutionIncomplete: PlainDescriptor<undefined>;
        /**
         * Too many locations authorized to alias origin.
         */
        TooManyAuthorizedAliases: PlainDescriptor<undefined>;
        /**
         * Expiry block number is in the past.
         */
        ExpiresInPast: PlainDescriptor<undefined>;
        /**
         * The alias to remove authorization for was not found.
         */
        AliasNotFound: PlainDescriptor<undefined>;
        /**
         * Local XCM execution incomplete with the actual XCM error and the index of the
         * instruction that caused the error.
         */
        LocalExecutionIncompleteWithError: PlainDescriptor<Anonymize<I5r8t4iaend96p>>;
    };
    MessageQueue: {
        /**
         * Page is not reapable because it has items remaining to be processed and is not old
         * enough.
         */
        NotReapable: PlainDescriptor<undefined>;
        /**
         * Page to be reaped does not exist.
         */
        NoPage: PlainDescriptor<undefined>;
        /**
         * The referenced message could not be found.
         */
        NoMessage: PlainDescriptor<undefined>;
        /**
         * The message was already processed and cannot be processed again.
         */
        AlreadyProcessed: PlainDescriptor<undefined>;
        /**
         * The message is queued for future execution.
         */
        Queued: PlainDescriptor<undefined>;
        /**
         * There is temporarily not enough weight to continue servicing messages.
         */
        InsufficientWeight: PlainDescriptor<undefined>;
        /**
         * This message is temporarily unprocessable.
         *
         * Such errors are expected, but not guaranteed, to resolve themselves eventually through
         * retrying.
         */
        TemporarilyUnprocessable: PlainDescriptor<undefined>;
        /**
         * The queue is paused and no message can be executed from it.
         *
         * This can change at any time and may resolve in the future by re-trying.
         */
        QueuePaused: PlainDescriptor<undefined>;
        /**
         * Another call is in progress and needs to finish before this call can happen.
         */
        RecursiveDisallowed: PlainDescriptor<undefined>;
    };
    Utility: {
        /**
         * Too many calls batched.
         */
        TooManyCalls: PlainDescriptor<undefined>;
    };
    Multisig: {
        /**
         * Threshold must be 2 or greater.
         */
        MinimumThreshold: PlainDescriptor<undefined>;
        /**
         * Call is already approved by this signatory.
         */
        AlreadyApproved: PlainDescriptor<undefined>;
        /**
         * Call doesn't need any (more) approvals.
         */
        NoApprovalsNeeded: PlainDescriptor<undefined>;
        /**
         * There are too few signatories in the list.
         */
        TooFewSignatories: PlainDescriptor<undefined>;
        /**
         * There are too many signatories in the list.
         */
        TooManySignatories: PlainDescriptor<undefined>;
        /**
         * The signatories were provided out of order; they should be ordered.
         */
        SignatoriesOutOfOrder: PlainDescriptor<undefined>;
        /**
         * The sender was contained in the other signatories; it shouldn't be.
         */
        SenderInSignatories: PlainDescriptor<undefined>;
        /**
         * Multisig operation not found in storage.
         */
        NotFound: PlainDescriptor<undefined>;
        /**
         * Only the account that originally created the multisig is able to cancel it or update
         * its deposits.
         */
        NotOwner: PlainDescriptor<undefined>;
        /**
         * No timepoint was given, yet the multisig operation is already underway.
         */
        NoTimepoint: PlainDescriptor<undefined>;
        /**
         * A different timepoint was given to the multisig operation that is underway.
         */
        WrongTimepoint: PlainDescriptor<undefined>;
        /**
         * A timepoint was given, yet no multisig operation is underway.
         */
        UnexpectedTimepoint: PlainDescriptor<undefined>;
        /**
         * The maximum weight information provided was too low.
         */
        MaxWeightTooLow: PlainDescriptor<undefined>;
        /**
         * The data to be stored is already stored.
         */
        AlreadyStored: PlainDescriptor<undefined>;
    };
    Sudo: {
        /**
         * Sender must be the Sudo account.
         */
        RequireSudo: PlainDescriptor<undefined>;
    };
    Proxy: {
        /**
         * There are too many proxies registered or too many announcements pending.
         */
        TooMany: PlainDescriptor<undefined>;
        /**
         * Proxy registration not found.
         */
        NotFound: PlainDescriptor<undefined>;
        /**
         * Sender is not a proxy of the account to be proxied.
         */
        NotProxy: PlainDescriptor<undefined>;
        /**
         * A call which is incompatible with the proxy type's filter was attempted.
         */
        Unproxyable: PlainDescriptor<undefined>;
        /**
         * Account is already a proxy.
         */
        Duplicate: PlainDescriptor<undefined>;
        /**
         * Call may not be made by proxy because it may escalate its privileges.
         */
        NoPermission: PlainDescriptor<undefined>;
        /**
         * Announcement, if made at all, was made too recently.
         */
        Unannounced: PlainDescriptor<undefined>;
        /**
         * Cannot add self as proxy.
         */
        NoSelfProxy: PlainDescriptor<undefined>;
    };
    Identity: {
        /**
         * Too many subs-accounts.
         */
        TooManySubAccounts: PlainDescriptor<undefined>;
        /**
         * No alias found for an account.
         */
        NoAlias: PlainDescriptor<undefined>;
        /**
         * Account isn't found.
         */
        NotFound: PlainDescriptor<undefined>;
        /**
         * Account isn't named.
         */
        NotNamed: PlainDescriptor<undefined>;
        /**
         * Empty index.
         */
        EmptyIndex: PlainDescriptor<undefined>;
        /**
         * Fee is changed.
         */
        FeeChanged: PlainDescriptor<undefined>;
        /**
         * No identity found.
         */
        NoIdentity: PlainDescriptor<undefined>;
        /**
         * Sticky judgement.
         */
        StickyJudgement: PlainDescriptor<undefined>;
        /**
         * Judgement given.
         */
        JudgementGiven: PlainDescriptor<undefined>;
        /**
         * Invalid judgement.
         */
        InvalidJudgement: PlainDescriptor<undefined>;
        /**
         * The index is invalid.
         */
        InvalidIndex: PlainDescriptor<undefined>;
        /**
         * The target is invalid.
         */
        InvalidTarget: PlainDescriptor<undefined>;
        /**
         * Maximum amount of registrars reached. Cannot add any more.
         */
        TooManyRegistrars: PlainDescriptor<undefined>;
        /**
         * Account ID is already named.
         */
        AlreadyClaimed: PlainDescriptor<undefined>;
        /**
         * Username has already been reported.
         */
        AlreadyReported: PlainDescriptor<undefined>;
        /**
         * Sender is not a sub-account.
         */
        NotSub: PlainDescriptor<undefined>;
        /**
         * Sub-account isn't owned by sender.
         */
        NotOwned: PlainDescriptor<undefined>;
        /**
         * The provided judgement was for a different identity.
         */
        JudgementForDifferentIdentity: PlainDescriptor<undefined>;
        /**
         * Error that occurs when there is an issue paying for judgement.
         */
        JudgementPaymentFailed: PlainDescriptor<undefined>;
        /**
         * The provided suffix is too long.
         */
        InvalidSuffix: PlainDescriptor<undefined>;
        /**
         * The sender does not have permission to issue a username.
         */
        NotUsernameAuthority: PlainDescriptor<undefined>;
        /**
         * The authority cannot allocate any more usernames.
         */
        NoAllocation: PlainDescriptor<undefined>;
        /**
         * The signature on a username was not valid.
         */
        InvalidSignature: PlainDescriptor<undefined>;
        /**
         * Setting this username requires a signature, but none was provided.
         */
        RequiresSignature: PlainDescriptor<undefined>;
        /**
         * The username does not meet the requirements.
         */
        InvalidUsername: PlainDescriptor<undefined>;
        /**
         * The username is already taken.
         */
        UsernameTaken: PlainDescriptor<undefined>;
        /**
         * The requested username does not exist.
         */
        NoUsername: PlainDescriptor<undefined>;
        /**
         * The reported username was not provided by the system.
         */
        NotSystemProvidedUsername: PlainDescriptor<undefined>;
        /**
         * The username cannot be forcefully removed because it can still be accepted.
         */
        NotExpired: PlainDescriptor<undefined>;
        /**
         * The username cannot be removed because it's still in the grace period.
         */
        TooEarly: PlainDescriptor<undefined>;
        /**
         * The username cannot be removed because it is not unbinding.
         */
        NotUnbinding: PlainDescriptor<undefined>;
        /**
         * The username cannot be unbound because it is already unbinding.
         */
        AlreadyUnbinding: PlainDescriptor<undefined>;
        /**
         * The action cannot be performed because of insufficient privileges (e.g. authority
         * trying to unbind a username provided by the system).
         */
        InsufficientPrivileges: PlainDescriptor<undefined>;
        /**
         * The context in which the alias was used is not supported.
         */
        BadContext: PlainDescriptor<undefined>;
        /**
         * No associated request for the judgement received.
         */
        UnexpectedJudgement: PlainDescriptor<undefined>;
        /**
         * The social credential is not supported by the configured identity information provider.
         */
        NotSupported: PlainDescriptor<undefined>;
        /**
         * The person is banned and cannot perform the operation.
         */
        Banned: PlainDescriptor<undefined>;
        /**
         * The person already has a personal identity associated with their alias.
         */
        AlreadyRegistered: PlainDescriptor<undefined>;
        /**
         * The list of judgements ongoing on a personal identity is full.
         */
        JudgementListFull: PlainDescriptor<undefined>;
        /**
         * The username has been reported too recently.
         */
        LastUsernameReportTooRecent: PlainDescriptor<undefined>;
        /**
         * The username has been reported and is undergoing validity judgement.
         */
        UsernameJudgementOngoing: PlainDescriptor<undefined>;
    };
    People: {
        /**
         * The supplied identifier does not represent a person.
         */
        NotPerson: PlainDescriptor<undefined>;
        /**
         * The given person has no associated key.
         */
        NoKey: PlainDescriptor<undefined>;
        /**
         * The context is not a member of those allowed to have account aliases held.
         */
        InvalidContext: PlainDescriptor<undefined>;
        /**
         * The account is not known.
         */
        InvalidAccount: PlainDescriptor<undefined>;
        /**
         * The account is already in use under another alias.
         */
        AccountInUse: PlainDescriptor<undefined>;
        /**
         * The proof is invalid.
         */
        InvalidProof: PlainDescriptor<undefined>;
        /**
         * The signature is invalid.
         */
        InvalidSignature: PlainDescriptor<undefined>;
        /**
         * There are not yet any members of our personhood set.
         */
        NoMembers: PlainDescriptor<undefined>;
        /**
         * The root cannot be finalized as there are still unpushed members.
         */
        Incomplete: PlainDescriptor<undefined>;
        /**
         * The root is still fresh.
         */
        StillFresh: PlainDescriptor<undefined>;
        /**
         * Too many members have been pushed.
         */
        TooManyMembers: PlainDescriptor<undefined>;
        /**
         * Key already in use by another person.
         */
        KeyAlreadyInUse: PlainDescriptor<undefined>;
        /**
         * The old key was not found when expected.
         */
        KeyNotFound: PlainDescriptor<undefined>;
        /**
         * Could not push member into the ring.
         */
        CouldNotPush: PlainDescriptor<undefined>;
        /**
         * The record is already using this key.
         */
        SameKey: PlainDescriptor<undefined>;
        /**
         * Personal Id was not reserved.
         */
        PersonalIdNotReserved: PlainDescriptor<undefined>;
        /**
         * Personal Id has never been reserved.
         */
        PersonalIdReservationCannotRenew: PlainDescriptor<undefined>;
        /**
         * Personal Id was not reserved or not already recognized.
         */
        PersonalIdNotReservedOrNotRecognized: PlainDescriptor<undefined>;
        /**
         * Ring cannot be merged if it's the top ring.
         */
        InvalidRing: PlainDescriptor<undefined>;
        /**
         * Ring cannot be built while there are suspensions pending.
         */
        SuspensionsPending: PlainDescriptor<undefined>;
        /**
         * Ring cannot be merged if it's not below 1/2 capacity.
         */
        RingAboveMergeThreshold: PlainDescriptor<undefined>;
        /**
         * Suspension indices provided are invalid.
         */
        InvalidSuspensions: PlainDescriptor<undefined>;
        /**
         * An mutating action was queued when there was no mutation session in progress.
         */
        NoMutationSession: PlainDescriptor<undefined>;
        /**
         * An mutating session could not be started.
         */
        CouldNotStartMutationSession: PlainDescriptor<undefined>;
        /**
         * Cannot merge rings while a suspension session is in progress.
         */
        SuspensionSessionInProgress: PlainDescriptor<undefined>;
        /**
         * The alias mapping is not stale.
         */
        AliasNotStale: PlainDescriptor<undefined>;
        /**
         * Call is too late or too early.
         */
        TimeOutOfRange: PlainDescriptor<undefined>;
        /**
         * Alias <-> Account is already set and up to date.
         */
        AliasAccountAlreadySet: PlainDescriptor<undefined>;
        /**
         * Personhood cannot be resumed if it is not suspended.
         */
        NotSuspended: PlainDescriptor<undefined>;
        /**
         * Personhood is suspended.
         */
        Suspended: PlainDescriptor<undefined>;
        /**
         * Invalid state for attempted key migration.
         */
        InvalidKeyMigration: PlainDescriptor<undefined>;
        /**
         * Invalid suspension of a key belonging to a person whose index in the ring has already
         * been included in the pending suspensions list.
         */
        KeyAlreadySuspended: PlainDescriptor<undefined>;
        /**
         * The onboarding size must not exceed the maximum ring size.
         */
        InvalidOnboardingSize: PlainDescriptor<undefined>;
        /**
         * The member key is not valid for the crypto.
         */
        InvalidMemberKey: PlainDescriptor<undefined>;
        /**
         * The people collection has already been created.
         */
        PeopleCollectionAlreadyExists: PlainDescriptor<undefined>;
        /**
         * The provided alias does not match the account's current alias mapping.
         */
        AliasMismatch: PlainDescriptor<undefined>;
        /**
         * None of the supplied aliases were stale.
         */
        NoStaleAliases: PlainDescriptor<undefined>;
    };
    MobRule: {
        /**
         * The case does not exist.
         */
        NoSuchCase: PlainDescriptor<undefined>;
        /**
         * The vote does not exist.
         */
        NoSuchVote: PlainDescriptor<undefined>;
        /**
         * The case is not open.
         */
        NotOpen: PlainDescriptor<undefined>;
        /**
         * The case is not ripe.
         */
        NotRipe: PlainDescriptor<undefined>;
        /**
         * The case is not yet done.
         */
        NotDone: PlainDescriptor<undefined>;
        /**
         * The decode of the call failed. Maybe there was a breaking runtime upgrade in between?
         */
        CodecError: PlainDescriptor<undefined>;
        /**
         * The call failed to dispatch. Maybe there was a breaking runtime upgrade in between?
         */
        DispatchError: PlainDescriptor<undefined>;
        /**
         * The case is too recent to be reaped.
         */
        Recent: PlainDescriptor<undefined>;
        /**
         * Not enough credit to payout the rewards.
         */
        NoCredit: PlainDescriptor<undefined>;
        /**
         * No mob credit distribution in place to reward voters.
         */
        NoReward: PlainDescriptor<undefined>;
        /**
         * No points to be converted to mob credit.
         */
        NoPoints: PlainDescriptor<undefined>;
        /**
         * Too many vote claims.
         */
        TooManyClaims: PlainDescriptor<undefined>;
        /**
         * No payout in progress.
         */
        NoPayout: PlainDescriptor<undefined>;
        /**
         * The point and/or credit arithmetic overflows.
         */
        ArithmeticOverflow: PlainDescriptor<undefined>;
        /**
         * Too many payout round schedules.
         */
        TooManySchedules: PlainDescriptor<undefined>;
        /**
         * No payout round schedule found.
         */
        NoSchedule: PlainDescriptor<undefined>;
        /**
         * No vote penalty found.
         */
        NoPenalty: PlainDescriptor<undefined>;
        /**
         * The vote penalty has not expired yet.
         */
        Early: PlainDescriptor<undefined>;
        /**
         * The vote cannot be cast due to a voting penalty in effect.
         */
        UnderPenalty: PlainDescriptor<undefined>;
        /**
         * The open case expiration is disabled due to insufficient active voters.
         */
        CaseExpirationDisabled: PlainDescriptor<undefined>;
    };
    ProofOfInk: {
        /**
         * Account is already applying to make a proof-of-ink.
         */
        InProgress: PlainDescriptor<undefined>;
        /**
         * Account has not been referred.
         */
        NoReferral: PlainDescriptor<undefined>;
        /**
         * The callback context is invalid; this should never happen.
         */
        BadContext: PlainDescriptor<undefined>;
        /**
         * The incoming judgement ID is not what we were expecting for the account.
         */
        UnexpectedJudgement: PlainDescriptor<undefined>;
        /**
         * No arguments were supplied with the judgement.
         */
        NoArgs: PlainDescriptor<undefined>;
        /**
         * The account has not applied to make a proof-of-ink.
         */
        NotApplied: PlainDescriptor<undefined>;
        /**
         * The candidate has not committed to a design.
         */
        NotSelected: PlainDescriptor<undefined>;
        /**
         * The candidate did not prove themselves yet.
         */
        NotProven: PlainDescriptor<undefined>;
        /**
         * The candidate has already started their judgement.
         */
        AlreadyStarted: PlainDescriptor<undefined>;
        /**
         * The personal ID is not in range.
         */
        OutOfRange: PlainDescriptor<undefined>;
        /**
         * The personal ID has already been taken.
         */
        AlreadyTaken: PlainDescriptor<undefined>;
        /**
         * The person has no more referrals left to give.
         */
        NoMoreReferrals: PlainDescriptor<undefined>;
        /**
         * The reroll is too early.
         */
        TooEarly: PlainDescriptor<undefined>;
        /**
         * The referrer's design is not procedural.
         */
        DesignInvalid: PlainDescriptor<undefined>;
        /**
         * The referrer's design is already taken.
         */
        DesignTaken: PlainDescriptor<undefined>;
        /**
         * The referrer doesn't appear to be a person. This should never happen.
         */
        BadParent: PlainDescriptor<undefined>;
        /**
         * The design family doesn't exist.
         */
        BadFamily: PlainDescriptor<undefined>;
        /**
         * The design family is invalid for this choice.
         */
        WrongFamily: PlainDescriptor<undefined>;
        /**
         * The index of the design or variant is beyond the allowed maximum for the family.
         */
        IndexTooBig: PlainDescriptor<undefined>;
        /**
         * The system is busy with too many commitments; try again later.
         */
        Busy: PlainDescriptor<undefined>;
        /**
         * The person has been banned from referring.
         */
        Banned: PlainDescriptor<undefined>;
        /**
         * The candidate has not demonstrated probably through the initial evidence.
         */
        Improbable: PlainDescriptor<undefined>;
        /**
         * The personal identity has already been reserved.
         */
        IdReserved: PlainDescriptor<undefined>;
        /**
         * The personal identity is already taken by a proven person.
         */
        IdUsed: PlainDescriptor<undefined>;
        /**
         * The ticket provided is invalid.
         */
        InvalidTicket: PlainDescriptor<undefined>;
        /**
         * The caller has not provided a referral or invitation ticket.
         */
        NoTicket: PlainDescriptor<undefined>;
        /**
         * The account is not authorized to do this.
         */
        NotAuthorized: PlainDescriptor<undefined>;
        /**
         * The personal identity doesn't exist.
         */
        NotPerson: PlainDescriptor<undefined>;
        /**
         * The candidate is referred. But the operation requires the candidate to not be referred.
         */
        ReferredCandidate: PlainDescriptor<undefined>;
        /**
         * The candidate is not referred. But the operation requires the candidate to be referred.
         */
        NotReferredCandidate: PlainDescriptor<undefined>;
        /**
         * There is no referral reward to register.
         */
        NoRewardToRegister: PlainDescriptor<undefined>;
        /**
         * There is a pending referral reward that must be registered first.
         */
        RewardToRegister: PlainDescriptor<undefined>;
        /**
         * No inviter found.
         */
        NoInviter: PlainDescriptor<undefined>;
        /**
         * Invalid signature.
         */
        InvalidSignature: PlainDescriptor<undefined>;
        /**
         * No invite available.
         */
        NoInvites: PlainDescriptor<undefined>;
        /**
         * Invite is already set.
         */
        AlreadyInvited: PlainDescriptor<undefined>;
        /**
         * The referrer is not a person.
         */
        NoReferrer: PlainDescriptor<undefined>;
        /**
         * The individual is not a person recognized by proof of ink.
         */
        NotPoiPerson: PlainDescriptor<undefined>;
        /**
         * The proof of ownership is invalid.
         */
        InvalidProofOfOwnership: PlainDescriptor<undefined>;
        /**
         * The reimbursement values are invalid.
         */
        InvalidReimbursementValues: PlainDescriptor<undefined>;
    };
    Game: {
        /**
         * Game ongoing.
         */
        GameOngoing: PlainDescriptor<undefined>;
        /**
         * No registration phase ongoing.
         */
        NoRegistration: PlainDescriptor<undefined>;
        /**
         * The setup is outdated.
         */
        OutdatedGameSetup: PlainDescriptor<undefined>;
        /**
         * Invalid setup.
         */
        InvalidGameSetup: PlainDescriptor<undefined>;
        /**
         * Invalid report.
         */
        InvalidReport: PlainDescriptor<undefined>;
        /**
         * No game ongoing.
         */
        NoGame: PlainDescriptor<undefined>;
        /**
         * No report phase ongoing.
         */
        NoReporting: PlainDescriptor<undefined>;
        /**
         * Not registered.
         */
        NotRegistered: PlainDescriptor<undefined>;
        /**
         * Player already registered.
         */
        AlreadyRegistered: PlainDescriptor<undefined>;
        /**
         * Report already sent.
         */
        ReportAlreadySent: PlainDescriptor<undefined>;
        /**
         * Operation is not valid yet.
         */
        Early: PlainDescriptor<undefined>;
        /**
         * The operation expect a player account.
         */
        NotKickablePlayer: PlainDescriptor<undefined>;
        /**
         * No archived player found.
         */
        NoArchivedPlayer: PlainDescriptor<undefined>;
        /**
         * No ticket found.
         */
        NoTicket: PlainDescriptor<undefined>;
        /**
         * No invite available.
         */
        NoInvites: PlainDescriptor<undefined>;
        /**
         * Invite is already set.
         */
        AlreadyInvited: PlainDescriptor<undefined>;
        /**
         * Not an account based player, expected an account based player.
         */
        NotAccountPlayer: PlainDescriptor<undefined>;
        /**
         * The player can't use an invite if already playing.
         */
        UseInviteButAlreadyPlaying: PlainDescriptor<undefined>;
        /**
         * The number of existing schedules and new schedules exceeds the configured limit.
         */
        TooManyGameSchedules: PlainDescriptor<undefined>;
        /**
         * The game that was supposed to be removed was not found in scheduled games.
         */
        NoSuchGameScheduled: PlainDescriptor<undefined>;
        /**
         * The statement account signature is invalid.
         */
        InvalidStatementAccountSignature: PlainDescriptor<undefined>;
        /**
         * The statement account is already in used by another player.
         */
        StatementAccountAlreadyInUse: PlainDescriptor<undefined>;
        /**
         * Internal error invalid state.
         */
        InternalErrorInvalidState: PlainDescriptor<undefined>;
        /**
         * The operation cannot be performed in the current game state.
         */
        InvalidGameState: PlainDescriptor<undefined>;
        /**
         * No player found.
         */
        NoPlayer: PlainDescriptor<undefined>;
        /**
         * The player cannot offboard while registered for a game.
         */
        CannotOffboardWhileRegisteredForGame: PlainDescriptor<undefined>;
        /**
         * Invalid state
         */
        InvalidState: PlainDescriptor<undefined>;
        /**
         * `set_play_deposit`: the supplied amount must be non-zero.
         */
        InvalidPlayDeposit: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidAirdropVrfVariantForAccount: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidAirdropVrfVariantForRecognition: PlainDescriptor<undefined>;
        /**
         * `claim_airdrop`: the claimant is not recognized in pallet-score, or their most recent
         * attended game does not match the `game_index` of the airdrop.
         */
        NotEligibleForAirdrop: PlainDescriptor<undefined>;
    };
    Score: {
        /**
         * The calling origin is not a person.
         */
        NotPerson: PlainDescriptor<undefined>;
        /**
         * The person didn't reach personhood.
         */
        HasNotReachedPersonhood: PlainDescriptor<undefined>;
        /**
         * No reward available.
         */
        NoReward: PlainDescriptor<undefined>;
        /**
         * The person has no associated score.
         */
        NoScore: PlainDescriptor<undefined>;
        /**
         * No payout schedule available.
         */
        NoSchedule: PlainDescriptor<undefined>;
        /**
         * Too many payout schedules already registered.
         */
        TooManySchedules: PlainDescriptor<undefined>;
        /**
         * The participant is recognized or has been recognized as a person.
         */
        Recognized: PlainDescriptor<undefined>;
        /**
         * The participant has already cashed out in this era.
         */
        CashOutCooldown: PlainDescriptor<undefined>;
        /**
         * The round is on going or no schedule.
         */
        RoundOnGoingOrNoSchedule: PlainDescriptor<undefined>;
        /**
         * The payout round has not started.
         */
        NoRound: PlainDescriptor<undefined>;
        /**
         * The origin is neither a person nor a signed account.
         */
        BadOriginNotPersonNotSigned: PlainDescriptor<undefined>;
        /**
         * The origin is neither a person nor a signed account nor an account participant.
         */
        BadOriginNotPersonNotSignedNotAccountParticipant: PlainDescriptor<undefined>;
        /**
         * The origin is neither a signed account nor an account participant.
         */
        BadOriginNotSignedNotAccountParticipant: PlainDescriptor<undefined>;
        /**
         * The participant is already participating.
         */
        AlreadyParticipating: PlainDescriptor<undefined>;
        /**
         * The key must be provided.
         */
        KeyMustBeProvided: PlainDescriptor<undefined>;
        /**
         * The key must not be provided.
         */
        KeyMustNotBeProvided: PlainDescriptor<undefined>;
        /**
         * Has reached personhood in the past.
         */
        HasReachedPersonhood: PlainDescriptor<undefined>;
        /**
         * The proof of ownership is invalid.
         */
        InvalidProofOfOwnership: PlainDescriptor<undefined>;
        /**
         * An absence grace tier has a window exceeding the maximum trackable history (8).
         */
        WindowTooLarge: PlainDescriptor<undefined>;
        /**
         * The allowed misses must be strictly less than the window (or both zero).
         */
        AllowedMissesTooLarge: PlainDescriptor<undefined>;
        /**
         * Absence-grace tiers must be sorted by ascending `population_size_threshold`.
         */
        AbsenceScheduleNotSorted: PlainDescriptor<undefined>;
        /**
         * The personhood-threshold schedule must contain at least one tier.
         */
        PersonhoodScheduleEmpty: PlainDescriptor<undefined>;
        /**
         * A personhood-threshold tier has `score_threshold == 0`.
         */
        PersonhoodScoreThresholdZero: PlainDescriptor<undefined>;
        /**
         * A personhood-threshold tier exceeds `MAX_PERSONHOOD_THRESHOLD`.
         */
        PersonhoodScoreThresholdTooLarge: PlainDescriptor<undefined>;
        /**
         * Personhood-threshold tiers must be sorted by ascending
         * `population_size_threshold`.
         */
        PersonhoodScheduleNotSorted: PlainDescriptor<undefined>;
        /**
         * Personhood-threshold `score_threshold` values must be non-decreasing
         * across tiers (a larger population must not have a lower bar).
         */
        PersonhoodScheduleNotMonotonic: PlainDescriptor<undefined>;
        /**
         * The last personhood-threshold tier must cover all populations
         * (`population_size_threshold == u32::MAX`).
         */
        PersonhoodScheduleNotTotal: PlainDescriptor<undefined>;
    };
    DummyDim: {
        /**
         * The personal ID does not belong to a recognized person.
         */
        NotPerson: PlainDescriptor<undefined>;
        /**
         * The personal ID does not belong to a suspended person.
         */
        NotSuspended: PlainDescriptor<undefined>;
        /**
         * The personal ID is not reserved and awaiting recognition.
         */
        NotReserved: PlainDescriptor<undefined>;
        /**
         * The operation does not support this many people.
         */
        TooManyPeople: PlainDescriptor<undefined>;
    };
    PeopleLite: {
        /**
         * No attestation allowance.
         */
        NoAttestationAllowance: PlainDescriptor<undefined>;
        /**
         * The signature created by the candidate's account is invalid.
         */
        InvalidAttestationSignature: PlainDescriptor<undefined>;
        /**
         * The signature created by the candidate's ring vrf key is invalid.
         */
        InvalidProofOfOwnership: PlainDescriptor<undefined>;
        /**
         * The candidate is already registered.
         */
        AlreadyRegistered: PlainDescriptor<undefined>;
        /**
         * The ring VRF key is already enrolled by another lite person.
         */
        KeyAlreadyInUse: PlainDescriptor<undefined>;
        /**
         * The account is already in use.
         */
        AccountInUse: PlainDescriptor<undefined>;
        /**
         * The alias <-> account mapping is already set and current.
         */
        AliasAccountAlreadySet: PlainDescriptor<undefined>;
        /**
         * The alias <-> account mapping is not set.
         */
        AliasAccountNotSet: PlainDescriptor<undefined>;
        /**
         * The requested alias setup block window is invalid for the current block.
         */
        CallBlockOutOfRange: PlainDescriptor<undefined>;
        /**
         * The alias context is invalid.
         */
        InvalidAliasContext: PlainDescriptor<undefined>;
        /**
         * The lite people member collection has not been initialized yet.
         */
        LitePeopleCollectionNotCreated: PlainDescriptor<undefined>;
    };
    Resources: {
        /**
         * Username does not fit the requirements.
         */
        InvalidUsername: PlainDescriptor<undefined>;
        /**
         * Username is already taken.
         */
        UsernameTaken: PlainDescriptor<undefined>;
        /**
         * Consumer is already registered.
         */
        AlreadyRegistered: PlainDescriptor<undefined>;
        /**
         * Provided proof of ownership is invalid.
         */
        InvalidProofOfOwnership: PlainDescriptor<undefined>;
        /**
         * Person is not registered as a consumer.
         */
        NotRegistered: PlainDescriptor<undefined>;
        /**
         * Consumer is not a full person.
         */
        NotFullPerson: PlainDescriptor<undefined>;
        /**
         * Attempted to update person authorization too early.
         */
        TouchNotReady: PlainDescriptor<undefined>;
        /**
         * Reservation is not active.
         */
        NoReservation: PlainDescriptor<undefined>;
        /**
         * The linked lite identity is not the active holder of the reservation.
         */
        NotReservationHolder: PlainDescriptor<undefined>;
        /**
         * The username in the reservation request is already taken.
         */
        UsernameReservationTaken: PlainDescriptor<undefined>;
        /**
         * The reservation has not expired.
         */
        ReservationFresh: PlainDescriptor<undefined>;
        /**
         * There is no lite consumer to be linked.
         */
        NoLinkedIdentity: PlainDescriptor<undefined>;
        /**
         * The lite consumer is already linked to a full person consumer.
         */
        AlreadyLinked: PlainDescriptor<undefined>;
        /**
         * The person's authorization has not expired yet.
         */
        PersonAuthNotExpired: PlainDescriptor<undefined>;
        /**
         * The person has already been demoted.
         */
        AlreadyDemoted: PlainDescriptor<undefined>;
        /**
         * Queue for this username is full.
         */
        QueueFull: PlainDescriptor<undefined>;
        /**
         * Account is not in the queue for this username.
         */
        NotInQueue: PlainDescriptor<undefined>;
        /**
         * Account already has a reservation for another username.
         */
        AlreadyHasReservation: PlainDescriptor<undefined>;
        /**
         * Friend request sequence is invalid for the consumer.
         */
        InvalidFriendRequestSequence: PlainDescriptor<undefined>;
        /**
         * Friend request period is not the current period.
         */
        InvalidFriendRequestPeriod: PlainDescriptor<undefined>;
        /**
         * Friend request registration is not expired yet.
         */
        FriendRequestRegistrationNotExpired: PlainDescriptor<undefined>;
        /**
         * Friend request registration already exists for the alias/context.
         */
        FriendRequestRegistrationAlreadyExists: PlainDescriptor<undefined>;
        /**
         * The replacement cooldown has not elapsed since the entry was last set.
         */
        StmtStoreReplacementTooEarly: PlainDescriptor<undefined>;
        /**
         * The provided `limit` exceeds `LongTermStorageCleanupLimit`.
         */
        LongTermStorageCleanupLimitExceeded: PlainDescriptor<undefined>;
    };
    ChunksManager: {
        /**
         * The requested chunk index doesn't exist.
         */
        ChunkNotFound: PlainDescriptor<undefined>;
        /**
         * The provided chunk data couldn't be decoded.
         */
        InvalidChunks: PlainDescriptor<undefined>;
        /**
         * The start index isn't strictly less than the end index.
         */
        InvalidChunkRange: PlainDescriptor<undefined>;
    };
    Members: {
        /**
         * The supplied identifier does not represent a member.
         */
        NotMember: PlainDescriptor<undefined>;
        /**
         * Ring has no root.
         */
        NoRoot: PlainDescriptor<undefined>;
        /**
         * The proof is invalid.
         */
        InvalidProof: PlainDescriptor<undefined>;
        /**
         * The root cannot be finalized as there are still unpushed members.
         */
        Incomplete: PlainDescriptor<undefined>;
        /**
         * Too many members have been pushed.
         */
        TooManyMembers: PlainDescriptor<undefined>;
        /**
         * Key already in use by another member.
         */
        KeyAlreadyInUse: PlainDescriptor<undefined>;
        /**
         * The old key was not found when expected.
         */
        KeyNotFound: PlainDescriptor<undefined>;
        /**
         * Could not push member into the ring.
         */
        CouldNotPush: PlainDescriptor<undefined>;
        /**
         * Ring cannot be merged if it's the top ring.
         */
        InvalidRing: PlainDescriptor<undefined>;
        /**
         * Ring cannot be built while there are suspensions pending.
         */
        SuspensionsPending: PlainDescriptor<undefined>;
        /**
         * Ring cannot be merged if it's not below 1/2 capacity.
         */
        RingAboveMergeThreshold: PlainDescriptor<undefined>;
        /**
         * Suspension indices provided are invalid.
         */
        InvalidSuspensions: PlainDescriptor<undefined>;
        /**
         * A mutating action was queued when there was no removal session in progress.
         */
        NoRemovalSession: PlainDescriptor<undefined>;
        /**
         * A removal session could not be started.
         */
        CouldNotStartRemovalSession: PlainDescriptor<undefined>;
        /**
         * Cannot merge rings while a removal session is in progress.
         */
        RemovalSessionInProgress: PlainDescriptor<undefined>;
        /**
         * Invalid suspension of a key belonging to a member whose index in the ring has already
         * been included in the pending suspensions list.
         */
        KeyAlreadySuspended: PlainDescriptor<undefined>;
        /**
         * The onboarding size must not exceed the maximum ring size.
         */
        InvalidOnboardingSize: PlainDescriptor<undefined>;
        /**
         * The member key is not valid for the crypto.
         */
        InvalidMemberKey: PlainDescriptor<undefined>;
        /**
         * The collection does not exist.
         */
        CollectionNotFound: PlainDescriptor<undefined>;
        /**
         * The collection already exists.
         */
        CollectionAlreadyExists: PlainDescriptor<undefined>;
        /**
         * Too many collections for this owner.
         */
        TooManyCollections: PlainDescriptor<undefined>;
        /**
         * Flexible collections must use the MaxFlexibleRingExponent ring size.
         */
        InvalidRingSizeForFlexible: PlainDescriptor<undefined>;
        /**
         * The ring exponent is not supported.
         */
        InvalidRingExponent: PlainDescriptor<undefined>;
        /**
         * Insufficient members in the queue to onboard.
         */
        PrematureOnboarding: PlainDescriptor<undefined>;
        /**
         * The collection is marked for deletion and cannot be modified.
         */
        CollectionMarkedForDeletion: PlainDescriptor<undefined>;
        /**
         * The caller is not the owner of the collection.
         */
        NotCollectionOwner: PlainDescriptor<undefined>;
        /**
         * The member is not in the onboarding queue.
         */
        NotOnboarding: PlainDescriptor<undefined>;
        /**
         * There is no ring root to build.
         */
        NothingToBuild: PlainDescriptor<undefined>;
    };
    Coinage: {
        /**
        
         */
        MemberKeyAlreadyUsed: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidMemberKey: PlainDescriptor<undefined>;
        /**
        
         */
        InternalError: PlainDescriptor<undefined>;
        /**
        
         */
        RecyclerAlreadyUnloaded: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidConsolidation: PlainDescriptor<undefined>;
        /**
        
         */
        ConsolidationTooBig: PlainDescriptor<undefined>;
        /**
        
         */
        CoinValueTooBig: PlainDescriptor<undefined>;
        /**
        
         */
        CoinValueTooSmall: PlainDescriptor<undefined>;
        /**
        
         */
        CoinValueIsLessThanFee: PlainDescriptor<undefined>;
        /**
        
         */
        CoinValueOutOfBound: PlainDescriptor<undefined>;
        /**
         * The coin value cannot be losslessly converted to an asset amount because
         * `UnderlyingAssetUnit` is not evenly divisible by `2^|value|`.
         */
        LossyCoinValueConversion: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidAliasProof: PlainDescriptor<undefined>;
        /**
        
         */
        NoUnloadingRecycler: PlainDescriptor<undefined>;
        /**
        
         */
        ProofAndAliasMismatch: PlainDescriptor<undefined>;
        /**
        
         */
        NothingToBuild: PlainDescriptor<undefined>;
        /**
        
         */
        TooManyRings: PlainDescriptor<undefined>;
        /**
        
         */
        AddressAlreadyHasCoin: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidProofOfOwnership: PlainDescriptor<undefined>;
        /**
        
         */
        EmptyInputs: PlainDescriptor<undefined>;
        /**
         * The fee recycler in the origin does not match the call's recycler.
         */
        RecyclerMismatch: PlainDescriptor<undefined>;
        /**
         * The total unloaded amount is less than the fee.
         */
        InsufficientUnloadForFee: PlainDescriptor<undefined>;
        /**
         * The first alias was not pre-marked by extension (required for FromOutput fee).
         */
        AliasNotPremarked: PlainDescriptor<undefined>;
        /**
         * The recycler revision does not match (recycler may not exist or has been rebuilt).
         */
        InvalidRecyclerRevision: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidSplit: PlainDescriptor<undefined>;
        /**
         * This operation requires a fresh coin (`age == 0`).
         */
        FreshCoinRequired: PlainDescriptor<undefined>;
        /**
        
         */
        CannotConvertNativeToAsset: PlainDescriptor<undefined>;
        /**
         * When using Prepaid fee mode, max_fee must be 0.
         */
        MaxFeeNotAllowedForPrepaid: PlainDescriptor<undefined>;
        /**
         * The max_fee exceeds the total input value.
         */
        MaxFeeExceedsInput: PlainDescriptor<undefined>;
        /**
         * The max fee argument doesn't satisfy the requirements.
         */
        InvalidMaxFee: PlainDescriptor<undefined>;
        /**
         * The recycler collection does not exist and could not be created on-demand.
         */
        CannotCreateRecyclerCollection: PlainDescriptor<undefined>;
        /**
         * The underlying asset id has not been set yet.
         */
        AssetIdNotSet: PlainDescriptor<undefined>;
        /**
         * The underlying asset id has already been set and cannot be changed.
         */
        AssetIdAlreadySet: PlainDescriptor<undefined>;
        /**
         * The proposed underlying asset id does not exist in [`Config::Fungibles`].
         */
        UnknownAsset: PlainDescriptor<undefined>;
    };
    MembersNotifier: {
        /**
         * Subscriber not found.
         */
        SubscriberNotFound: PlainDescriptor<undefined>;
        /**
         * Subscriber already exists.
         */
        AlreadySubscribed: PlainDescriptor<undefined>;
        /**
         * Maximum subscribers reached.
         */
        TooManySubscribers: PlainDescriptor<undefined>;
        /**
         * Collections list must be sorted in strictly ascending order with no duplicates.
         */
        InvalidCollectionsList: PlainDescriptor<undefined>;
        /**
         * Too many ring root updates to fit in a single batch.
         */
        TooManyUpdates: PlainDescriptor<undefined>;
        /**
         * XCM send failed.
         */
        XcmSendFailed: PlainDescriptor<undefined>;
        /**
         * Subscriber is not subscribed to the requested collection.
         */
        NotSubscribedToCollection: PlainDescriptor<undefined>;
        /**
         * Ring root index is out of range.
         */
        InvalidRingIndex: PlainDescriptor<undefined>;
        /**
         * Requested updates exceed the subscriber's HRMP channel capacity.
         */
        ExceedsChannelCapacity: PlainDescriptor<undefined>;
        /**
         * No active batch exists.
         */
        NoBatchActive: PlainDescriptor<undefined>;
        /**
         * No pending initialization for this subscriber.
         */
        NoPendingInit: PlainDescriptor<undefined>;
        /**
         * Replay cooldown has not elapsed for this subscriber and collection.
         */
        ReplayCooldownActive: PlainDescriptor<undefined>;
        /**
         * Replay requested with an empty list of ring root indices.
         */
        EmptyRingIndices: PlainDescriptor<undefined>;
    };
    Airdrop: {
        /**
        
         */
        PrizeBelowMinBalance: PlainDescriptor<undefined>;
        /**
        
         */
        NoWinnersConfigured: PlainDescriptor<undefined>;
        /**
        
         */
        TooManyWinners: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidEventTimes: PlainDescriptor<undefined>;
        /**
        
         */
        DuplicateEventId: PlainDescriptor<undefined>;
        /**
        
         */
        NoScheduledEvent: PlainDescriptor<undefined>;
        /**
        
         */
        UnknownEvent: PlainDescriptor<undefined>;
        /**
         * Operation requires a specific status the event isn't in.
         */
        WrongStatus: PlainDescriptor<undefined>;
        /**
        
         */
        NotAcceptingRegistrations: PlainDescriptor<undefined>;
        /**
        
         */
        NotClaiming: PlainDescriptor<undefined>;
        /**
         * Claim attempted after the event's `end_time`.
         */
        ClaimingWindowClosed: PlainDescriptor<undefined>;
        /**
        
         */
        EntropySlotTaken: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidVrfProof: PlainDescriptor<undefined>;
        /**
         * Supplied account id does not correspond to any sr25519 public key.
         */
        UnsupportedAccountKey: PlainDescriptor<undefined>;
        /**
        
         */
        InvalidMembershipProof: PlainDescriptor<undefined>;
        /**
        
         */
        NoSuchWinner: PlainDescriptor<undefined>;
        /**
        
         */
        ParticipantOverflow: PlainDescriptor<undefined>;
        /**
        
         */
        PrizeAllocationOverflow: PlainDescriptor<undefined>;
        /**
         * The prize asset has not been enabled via `enable_asset`.
         */
        AssetNotEnabled: PlainDescriptor<undefined>;
        /**
         * `enable_asset` was called for an asset that is already enabled.
         */
        AssetAlreadyEnabled: PlainDescriptor<undefined>;
    };
    Honour: {
        /**
         * Arithmetic error like over/underflow, division by zero or similar.
         */
        Arithmetic: PlainDescriptor<undefined>;
        /**
         * There is already a vote by the same voter for the same subject.
         */
        SubjectAlreadyVoted: PlainDescriptor<undefined>;
        /**
         * The provided ring proof failed verification.
         */
        InvalidProof: PlainDescriptor<undefined>;
    };
    MultiBlockMigrations: {
        /**
         * The operation cannot complete since some MBMs are ongoing.
         */
        Ongoing: PlainDescriptor<undefined>;
    };
};
type IConstants = {
    System: {
        /**
         * Block & extrinsics weights: base values and limits.
         */
        BlockWeights: PlainDescriptor<Anonymize<In7a38730s6qs>>;
        /**
         * The maximum length of a block (in bytes).
         */
        BlockLength: PlainDescriptor<Anonymize<Ibtil0ss5munbk>>;
        /**
         * Maximum number of block number to block hash mappings to keep (oldest pruned first).
         */
        BlockHashCount: PlainDescriptor<number>;
        /**
         * The weight of runtime database operations the runtime can invoke.
         */
        DbWeight: PlainDescriptor<Anonymize<I9s0ave7t0vnrk>>;
        /**
         * Get the chain's in-code version.
         */
        Version: PlainDescriptor<Anonymize<I4fo08joqmcqnm>>;
        /**
         * The designated SS58 prefix of this chain.
         *
         * This replaces the "ss58Format" property declared in the chain spec. Reason is
         * that the runtime should know about the prefix in order to make use of it as
         * an identifier of the chain.
         */
        SS58Prefix: PlainDescriptor<number>;
    };
    ParachainSystem: {
        /**
         * Returns the parachain ID we are running with.
         */
        SelfParaId: PlainDescriptor<number>;
    };
    Timestamp: {
        /**
         * The minimum period between blocks.
         *
         * Be aware that this is different to the *expected* period that the block production
         * apparatus provides. Your chosen consensus system will generally work with this to
         * determine a sensible block time. For example, in the Aura pallet it will be double this
         * period on default settings.
         */
        MinimumPeriod: PlainDescriptor<bigint>;
    };
    Balances: {
        /**
         * The minimum amount required to keep an account open. MUST BE GREATER THAN ZERO!
         *
         * If you *really* need it to be zero, you can enable the feature `insecure_zero_ed` for
         * this pallet. However, you do so at your own risk: this will open up a major DoS vector.
         * In case you have multiple sources of provider references, you may also get unexpected
         * behaviour if you set this to zero.
         *
         * Bottom line: Do yourself a favour and make it at least one!
         */
        ExistentialDeposit: PlainDescriptor<bigint>;
        /**
         * The maximum number of locks that should exist on an account.
         * Not strictly enforced, but used for weight estimation.
         *
         * Use of locks is deprecated in favour of freezes. See `https://github.com/paritytech/substrate/pull/12951/`
         */
        MaxLocks: PlainDescriptor<number>;
        /**
         * The maximum number of named reserves that can exist on an account.
         *
         * Use of reserves is deprecated in favour of holds. See `https://github.com/paritytech/substrate/pull/12951/`
         */
        MaxReserves: PlainDescriptor<number>;
        /**
         * The maximum number of individual freeze locks that can exist on an account at any time.
         */
        MaxFreezes: PlainDescriptor<number>;
    };
    TransactionPayment: {
        /**
         * A fee multiplier for `Operational` extrinsics to compute "virtual tip" to boost their
         * `priority`
         *
         * This value is multiplied by the `final_fee` to obtain a "virtual tip" that is later
         * added to a tip component in regular `priority` calculations.
         * It means that a `Normal` transaction can front-run a similarly-sized `Operational`
         * extrinsic (with no tip), by including a tip value greater than the virtual tip.
         *
         * ```rust,ignore
         * // For `Normal`
         * let priority = priority_calc(tip);
         *
         * // For `Operational`
         * let virtual_tip = (inclusion_fee + tip) * OperationalFeeMultiplier;
         * let priority = priority_calc(tip + virtual_tip);
         * ```
         *
         * Note that since we use `final_fee` the multiplier applies also to the regular `tip`
         * sent with the transaction. So, not only does the transaction get a priority bump based
         * on the `inclusion_fee`, but we also amplify the impact of tips applied to `Operational`
         * transactions.
         */
        OperationalFeeMultiplier: PlainDescriptor<number>;
    };
    Assets: {
        /**
         * Max number of items to destroy per `destroy_accounts` and `destroy_approvals` call.
         *
         * Must be configured to result in a weight that makes each call fit in a block.
         */
        RemoveItemsLimit: PlainDescriptor<number>;
        /**
         * The basic amount of funds that must be reserved for an asset.
         */
        AssetDeposit: PlainDescriptor<bigint>;
        /**
         * The amount of funds that must be reserved for a non-provider asset account to be
         * maintained.
         */
        AssetAccountDeposit: PlainDescriptor<bigint>;
        /**
         * The basic amount of funds that must be reserved when adding metadata to your asset.
         */
        MetadataDepositBase: PlainDescriptor<bigint>;
        /**
         * The additional funds that must be reserved for the number of bytes you store in your
         * metadata.
         */
        MetadataDepositPerByte: PlainDescriptor<bigint>;
        /**
         * The amount of funds that must be reserved when creating a new approval.
         */
        ApprovalDeposit: PlainDescriptor<bigint>;
        /**
         * The maximum length of a name or symbol stored on-chain.
         */
        StringLimit: PlainDescriptor<number>;
    };
    CollatorSelection: {
        /**
         * Account Identifier from which the internal Pot is generated.
         */
        PotId: PlainDescriptor<SizedHex<8>>;
        /**
         * Maximum number of candidates that we should have.
         *
         * This does not take into account the invulnerables.
         */
        MaxCandidates: PlainDescriptor<number>;
        /**
         * Minimum number eligible collators. Should always be greater than zero. This includes
         * Invulnerable collators. This ensures that there will always be one collator who can
         * produce a block.
         */
        MinEligibleCollators: PlainDescriptor<number>;
        /**
         * Maximum number of invulnerables.
         */
        MaxInvulnerables: PlainDescriptor<number>;
        /**
        
         */
        KickThreshold: PlainDescriptor<number>;
        /**
         * Gets this pallet's derived pot account.
         */
        pot_account: PlainDescriptor<SS58String>;
    };
    Session: {
        /**
         * The amount to be held when setting keys.
         */
        KeyDeposit: PlainDescriptor<bigint>;
    };
    Aura: {
        /**
         * The slot duration Aura should run with, expressed in milliseconds.
         *
         * The effective value of this type can be changed with a runtime upgrade.
         *
         * For backwards compatibility either use [`MinimumPeriodTimesTwo`] or a const.
         */
        SlotDuration: PlainDescriptor<bigint>;
    };
    XcmpQueue: {
        /**
         * The maximum number of inbound XCMP channels that can be suspended simultaneously.
         *
         * Any further channel suspensions will fail and messages may get dropped without further
         * notice. Choosing a high value (1000) is okay; the trade-off that is described in
         * [`InboundXcmpSuspended`] still applies at that scale.
         */
        MaxInboundSuspended: PlainDescriptor<number>;
        /**
         * Maximal number of outbound XCMP channels that can have messages queued at the same time.
         *
         * If this is reached, then no further messages can be sent to channels that do not yet
         * have a message queued. This should be set to the expected maximum of outbound channels
         * which is determined by [`Self::ChannelInfo`]. It is important to set this large enough,
         * since otherwise the congestion control protocol will not work as intended and messages
         * may be dropped. This value increases the PoV and should therefore not be picked too
         * high. Governance needs to pay attention to not open more channels than this value.
         */
        MaxActiveOutboundChannels: PlainDescriptor<number>;
        /**
         * The maximal page size for HRMP message pages.
         *
         * A lower limit can be set dynamically, but this is the hard-limit for the PoV worst case
         * benchmarking. The limit for the size of a message is slightly below this, since some
         * overhead is incurred for encoding the format.
         */
        MaxPageSize: PlainDescriptor<number>;
    };
    PolkadotXcm: {
        /**
         * This chain's Universal Location.
         */
        UniversalLocation: PlainDescriptor<XcmV5Junctions>;
        /**
         * The latest supported version that we advertise. Generally just set it to
         * `pallet_xcm::CurrentXcmVersion`.
         */
        AdvertisedXcmVersion: PlainDescriptor<number>;
        /**
         * The maximum number of local XCM locks that a single account may have.
         */
        MaxLockers: PlainDescriptor<number>;
        /**
         * The maximum number of consumers a single remote lock may have.
         */
        MaxRemoteLockConsumers: PlainDescriptor<number>;
    };
    MessageQueue: {
        /**
         * The size of the page; this implies the maximum message size which can be sent.
         *
         * A good value depends on the expected message sizes, their weights, the weight that is
         * available for processing them and the maximal needed message size. The maximal message
         * size is slightly lower than this as defined by [`MaxMessageLenOf`].
         */
        HeapSize: PlainDescriptor<number>;
        /**
         * The maximum number of stale pages (i.e. of overweight messages) allowed before culling
         * can happen. Once there are more stale pages than this, then historical pages may be
         * dropped, even if they contain unprocessed overweight messages.
         */
        MaxStale: PlainDescriptor<number>;
        /**
         * The amount of weight (if any) which should be provided to the message queue for
         * servicing enqueued items `on_initialize`.
         *
         * This may be legitimately `None` in the case that you will call
         * `ServiceQueues::service_queues` manually or set [`Self::IdleMaxServiceWeight`] to have
         * it run in `on_idle`.
         */
        ServiceWeight: PlainDescriptor<Anonymize<Iasb8k6ash5mjn>>;
        /**
         * The maximum amount of weight (if any) to be used from remaining weight `on_idle` which
         * should be provided to the message queue for servicing enqueued items `on_idle`.
         * Useful for parachains to process messages at the same block they are received.
         *
         * If `None`, it will not call `ServiceQueues::service_queues` in `on_idle`.
         */
        IdleMaxServiceWeight: PlainDescriptor<Anonymize<Iasb8k6ash5mjn>>;
    };
    Utility: {
        /**
         * The limit on the number of batched calls.
         */
        batched_calls_limit: PlainDescriptor<number>;
    };
    Multisig: {
        /**
         * The base amount of currency needed to reserve for creating a multisig execution or to
         * store a dispatch call for later.
         *
         * This is held for an additional storage item whose value size is
         * `4 + sizeof((BlockNumber, Balance, AccountId))` bytes and whose key size is
         * `32 + sizeof(AccountId)` bytes.
         */
        DepositBase: PlainDescriptor<bigint>;
        /**
         * The amount of currency needed per unit threshold when creating a multisig execution.
         *
         * This is held for adding 32 bytes more into a pre-existing storage value.
         */
        DepositFactor: PlainDescriptor<bigint>;
        /**
         * The maximum amount of signatories allowed in the multisig.
         */
        MaxSignatories: PlainDescriptor<number>;
    };
    Proxy: {
        /**
         * The base amount of currency needed to reserve for creating a proxy.
         *
         * This is held for an additional storage item whose value size is
         * `sizeof(Balance)` bytes and whose key size is `sizeof(AccountId)` bytes.
         */
        ProxyDepositBase: PlainDescriptor<bigint>;
        /**
         * The amount of currency needed per proxy added.
         *
         * This is held for adding 32 bytes plus an instance of `ProxyType` more into a
         * pre-existing storage value. Thus, when configuring `ProxyDepositFactor` one should take
         * into account `32 + proxy_type.encode().len()` bytes of data.
         */
        ProxyDepositFactor: PlainDescriptor<bigint>;
        /**
         * The maximum amount of proxies allowed for a single account.
         */
        MaxProxies: PlainDescriptor<number>;
        /**
         * The maximum amount of time-delayed announcements that are allowed to be pending.
         */
        MaxPending: PlainDescriptor<number>;
        /**
         * The base amount of currency needed to reserve for creating an announcement.
         *
         * This is held when a new storage item holding a `Balance` is created (typically 16
         * bytes).
         */
        AnnouncementDepositBase: PlainDescriptor<bigint>;
        /**
         * The amount of currency needed per announcement made.
         *
         * This is held for adding an `AccountId`, `Hash` and `BlockNumber` (typically 68 bytes)
         * into a pre-existing storage value.
         */
        AnnouncementDepositFactor: PlainDescriptor<bigint>;
    };
    Identity: {
        /**
         * The amount held on deposit for a registered identity.
         */
        BasicDeposit: PlainDescriptor<bigint>;
        /**
         * The amount held on deposit per encoded byte for a registered identity.
         */
        ByteDeposit: PlainDescriptor<bigint>;
        /**
         * The amount held on deposit per registered username. This value should change only in
         * runtime upgrades with proper migration of existing deposits.
         */
        UsernameDeposit: PlainDescriptor<bigint>;
        /**
         * The amount held on deposit for a registered subaccount. This should account for the fact
         * that one storage item's value will increase by the size of an account ID, and there will
         * be another trie item whose value is the size of an account ID plus 32 bytes.
         */
        SubAccountDeposit: PlainDescriptor<bigint>;
        /**
         * The amount held on deposit per reported username.
         */
        UsernameReportDeposit: PlainDescriptor<bigint>;
        /**
         * The maximum number of sub-accounts allowed per identified account.
         */
        MaxSubAccounts: PlainDescriptor<number>;
        /**
         * The number of blocks that have to pass between the last time a given username was
         * reported and now in order to be able to report it again. In other words, it represents
         * the username validity safety period.
         */
        UsernameReportTimeout: PlainDescriptor<number>;
        /**
         * Maximum number of registrars allowed in the system. Needed to bound the complexity
         * of, e.g., updating judgements.
         */
        MaxRegistrars: PlainDescriptor<number>;
        /**
         * Maximum number of judgements per personal identity allowed in the system.
         */
        MaxJudgements: PlainDescriptor<number>;
        /**
         * The number of blocks within which a username grant must be accepted.
         */
        PendingUsernameExpiration: PlainDescriptor<number>;
        /**
         * The number of blocks that must pass to enable the permanent deletion of a username by
         * its respective authority.
         */
        UsernameGracePeriod: PlainDescriptor<number>;
        /**
         * The maximum length of a suffix.
         */
        MaxSuffixLength: PlainDescriptor<number>;
        /**
         * The maximum length of a username, including its suffix and any system-added delimiters.
         */
        MaxUsernameLength: PlainDescriptor<number>;
        /**
         * The minimum length of a username or suffix.
         */
        MinUsernameLength: PlainDescriptor<number>;
        /**
         * The fee that a person must pay through their associated on-chain account in order to
         * remove their identity.
         */
        CredentialRemovalPenalty: PlainDescriptor<bigint>;
        /**
         * The context used for the proofs required to authenticate as a personal alias in
         * identity.
         */
        identity_context: PlainDescriptor<SizedHex<32>>;
    };
    People: {
        /**
         * The ring exponent used to operate the people member collection in `MemberService`.
         */
        RingExponent: PlainDescriptor<Anonymize<Idvob66qflhcgd>>;
        /**
         * Maximum number of people included in an onboarding queue page before a new one is
         * created.
         */
        OnboardingQueuePageSize: PlainDescriptor<number>;
        /**
         * Interval (in blocks) at which the offchain worker runs stale alias cleanup.
         */
        StaleAliasCleanupInterval: PlainDescriptor<number>;
        /**
         * The amount of block number tolerance we allow for a setup account transaction.
         *
         * `set_alias_account` and `set_personal_id_account` calls contains
         * `call_valid_at` as a parameter, those calls are valid if the block number is within
         * the tolerance period.
         */
        account_setup_time_tolerance: PlainDescriptor<number>;
    };
    MobRule: {
        /**
         * The location of the used currency. It is informational only.
         */
        CurrencyLocationInfo: PlainDescriptor<Anonymize<If9iqq7i64mur8>>;
        /**
         * The number of seconds before a case times out and can be reaped.
         */
        MaxVoteClaimDuration: PlainDescriptor<bigint>;
        /**
         * The number of seconds a case must stay open for voting before it can be closed.
         */
        MinCaseDuration: PlainDescriptor<number>;
        /**
         * The maximum number of seconds for which a case could stay open for voting.
         */
        MaxVotingDuration: PlainDescriptor<number>;
        /**
         * The minimum number of votes a case must receive before a verdict can be reached.
         */
        MinTurnoutNominal: PlainDescriptor<number>;
        /**
         * The minimum number of votes as a percentage of the total voter count a case must receive
         * before a verdict can be reached.
         */
        MinTurnoutPercentage: PlainDescriptor<number>;
        /**
         * The number of blocks that a penalty is applied for.
         */
        VotingPenaltyDuration: PlainDescriptor<number>;
        /**
         * The maximum number of votes claimable in a single extrinsic.
         */
        MaxVotesClaimable: PlainDescriptor<number>;
        /**
         * The interval at which offchain worker runs.
         */
        OffchainWorkInterval: PlainDescriptor<number>;
        /**
         * Maximum number of votes that will be cleaned during offchain worker run.
         */
        CleanVotesBatchSize: PlainDescriptor<number>;
        /**
         * The time in seconds during which votes can be claimed on done cases.
         * Measured from the time the case becomes 'Done'.
         */
        VotesOpenForClaimsDuration: PlainDescriptor<number>;
        /**
         * The minimum number of active voters required to allow voting. When this threshold is not
         * met, open cases cannot time out.
         */
        MinimumVoterThreshold: PlainDescriptor<number>;
        /**
         * Get a unique, inaccessible account ID from the `PotId`.
         */
        mob_rule_pot_id: PlainDescriptor<SS58String>;
        /**
         * The context used for the proofs required to authenticate as a personal alias in mob
         * rule.
         */
        mob_rule_context: PlainDescriptor<SizedHex<32>>;
    };
    ProofOfInk: {
        /**
         * The maximum number of active referrals a user can have open.
         * It cannot exceed 200.
         */
        MaxActiveReferrals: PlainDescriptor<number>;
        /**
         * Account Identifier from which the reward pot is generated.
         *
         * The account must be funded so rewards can be paid during registration and
         * referral reward claims.
         *
         * The `PalletId` must be a constant as it is exposed in the metadata.
         * Changing this value with a runtime upgrade can be done at any time, the new account will
         * then need to be funded accordingly.
         */
        PotId: PlainDescriptor<SizedHex<8>>;
        /**
         * The account ID of the pot used for reward transfers.
         */
        proof_of_ink_pot_id: PlainDescriptor<SS58String>;
    };
    Game: {
        /**
         * The maximum number of rounds in a game.
         *
         * Note: the actual number of rounds is configured per game.
         *
         * TODO: if this bound is raised meaningfully (e.g. above ~5) or when time allows,
         * revisit the `process_players` and `report` benchmarks to add a `Linear<1, MaxRounds>`
         * sweep. Currently they bench at fixed `MaxRounds` so games with fewer
         * rounds overpay for per-round work.
         * See https://github.com/paritytech/individuality/issues/244
         */
        MaxRounds: PlainDescriptor<number>;
        /**
         * The maximum number of players in a group.
         *
         * Note: the actual number of players in a group is configured per game.
         */
        MaxGroupSize: PlainDescriptor<number>;
        /**
         * The minimum number of players in a group.
         *
         * When scheduling a game the value for `max_group_size` must be at least this minimum + 1.
         *
         * In order to have no single-player groups, this value must be at least 2.
         *
         * Note: the actual minimum number of players in a group is configured per game, it is
         * `max_group_size - 1`.
         */
        MinGroupSize: PlainDescriptor<number>;
        /**
         * The time after which a player that is not playing can be kicked out.
         *
         * This is only for account players, not persons.
         */
        NonPlayingKickoutTime: PlainDescriptor<number>;
        /**
         * The default play deposit (native balance) used when [`PlayDepositAmount`] has never
         * been explicitly configured.
         */
        DefaultPlayDeposit: PlainDescriptor<bigint>;
        /**
         * The default durations of each game phase, in seconds. Overridden at
         * runtime via [`Pallet::set_game_phases`].
         */
        DefaultPhaseDurations: PlainDescriptor<Anonymize<I1mvbp74tfuinr>>;
        /**
         * The Maximum number of game schedules the pallet can store.
         */
        MaxGameSchedules: PlainDescriptor<number>;
        /**
         * The maximum number of past games for which player attendance is stored. Any attendance
         * entries older than this will be imminently purged from storage.
         */
        MaxAttendanceHistoryDepth: PlainDescriptor<number>;
        /**
         * Account that funds the per-game airdrop prize allocation
         * (`max_winners × asset_amount` is transferred per scheduled game).
         */
        AirdropSource: PlainDescriptor<SS58String>;
        /**
         * The base message of the proof of ownership of an account by an alias.
         *
         * The full message is this base concatenated to the alias and then hashed with
         * `blake2_256` (blake2 with 256 bit output).
         */
        proof_of_ownership_msg_base: PlainDescriptor<SizedHex<32>>;
        /**
         * Maximum number of full early-attendance enactments a single `report` call can
         * trigger: every unique co-player across all rounds, plus the reporter.
         *
         * Used both as the pre-dispatch overcharge bound on `report` and as the
         * upper bound of its `Linear` benchmark component.
         */
        max_enactments: PlainDescriptor<number>;
        /**
         * The base string for the airdrop event ID derivation. The actual event ID is this base
         * concatenated with the game index BE encoded.
         */
        airdrop_event_id_base: PlainDescriptor<SizedHex<28>>;
    };
    Score: {
        /**
         * The location of the used currency. It is informational only.
         */
        CurrencyLocationInfo: PlainDescriptor<Anonymize<If9iqq7i64mur8>>;
        /**
         * The interval at which offchain worker runs.
         */
        OffchainWorkInterval: PlainDescriptor<number>;
        /**
         * Get a unique, inaccessible account ID from the `PotId`.
         */
        score_pot_id: PlainDescriptor<SS58String>;
        /**
         * The context used for the proofs required to authenticate as a personal alias in score
         * pallet.
         */
        score_context: PlainDescriptor<SizedHex<32>>;
    };
    PeopleLite: {
        /**
         * Ring exponent used for the lite people collection.
         */
        LiteRingExponent: PlainDescriptor<Anonymize<Idvob66qflhcgd>>;
        /**
         * Onboarding size used when creating the lite people collection.
         */
        LiteOnboardingSize: PlainDescriptor<number>;
        /**
         * The number of blocks of tolerance we allow for an alias setup transaction.
         */
        account_setup_block_tolerance: PlainDescriptor<number>;
    };
    Resources: {
        /**
         * The maximum length of a username, including any potential trailing digits.
         */
        MaxUsernameLength: PlainDescriptor<number>;
        /**
         * The minimum length of a username.
         */
        MinUsernameLength: PlainDescriptor<number>;
        /**
         * The duration of time, in seconds, for which a person's authorization is valid. After
         * this period elapses, people will no longer be considered active, but their resource
         * allowances should default to the same values used for lite people.
         */
        PersonAuthDuration: PlainDescriptor<number>;
        /**
         * The minimum interval of time, in seconds, which must pass before updating a person's
         * authorization.
         */
        MinPersonAuthUpdateInterval: PlainDescriptor<number>;
        /**
         * Maximum number of accounts that can queue for a single reserved username.
         */
        MaxReservationQueueLength: PlainDescriptor<number>;
        /**
         * The Statement Store allowance for the accounts API.
         */
        AccountsApiAllowance: PlainDescriptor<Anonymize<I7qcffr6se5g9>>;
        /**
         * Maximum number of statement store slots a person can claim within one period.
         */
        StmtStoreSlotsPerPeriod: PlainDescriptor<number>;
        /**
         * Maximum number of statement store slots a lite person can claim within one period.
         *
         * Same semantics as `StmtStoreSlotsPerPeriod` but applied when the proof targets the
         * lite-people collection via `MembershipCollection::LitePeople`.
         */
        LiteStmtStoreSlotsPerPeriod: PlainDescriptor<number>;
        /**
         * Maximum number of stale statement store allowance entries to remove per cleanup call.
         */
        StmtStoreCleanupLimit: PlainDescriptor<number>;
        /**
         * Minimum time, in seconds, that must pass before an alias can replace its own
         * statement store allowance entry within the same period.
         */
        StmtStoreReplacementCooldown: PlainDescriptor<number>;
        /**
         * Extra time, in seconds, during which statement-store allowances from an ended period
         * remain active before cleanup may revoke them.
         *
         * After this elapses, the allowances will eventually be cleaned by the OCW.
         */
        StmtStoreGraceWindow: PlainDescriptor<number>;
        /**
         * The Statement Store allowance for friend request statement registration.
         */
        FriendRequestAllowance: PlainDescriptor<Anonymize<I7qcffr6se5g9>>;
        /**
         * Maximum number of friend requests a person can send within one rate-limit period.
         *
         * For example, if this is `8`, each person can send up to 8 friend requests during the
         * period selected by `FriendRequestPeriodDuration`. When the period advances, the slots
         * reset.
         */
        FriendRequestSlotsPerPeriod: PlainDescriptor<number>;
        /**
         * Maximum number of friend requests a lite person can send within one rate-limit period.
         *
         * Same semantics as `FriendRequestSlotsPerPeriod` but applied when the proof targets the
         * lite-people collection via `MembershipCollection::LitePeople`.
         */
        LiteFriendRequestSlotsPerPeriod: PlainDescriptor<number>;
        /**
         * Rolling time window for rate-limiting friend requests, in seconds.
         *
         * Time is divided into fixed-duration periods. The period index is computed as
         * `now_secs / FriendRequestPeriodDuration`.
         *
         * For example, if this is `86_400` (24 hours), period `0` is the first 24 hours since the
         * Unix epoch, period `1` is the next 24 hours, and so on. Combined with
         * `FriendRequestSlotsPerPeriod`, this defines how many friend requests can be sent in each
         * period.
         */
        FriendRequestPeriodDuration: PlainDescriptor<number>;
        /**
         * Extra time, in seconds, during which the previous friend request period is still
         * accepted after a rollover.
         *
         * This allows transactions created close to a period boundary to still be included even if
         * they are executed just after the next period begins.
         */
        FriendRequestGraceWindow: PlainDescriptor<number>;
        /**
         * Duration for which friend request registrations will be retained. Specified in seconds.
         *
         * A registration is created for a specific period. Once this period ends,
         * the registration remains valid for the configured duration, after which
         * it can be cleaned up. See `friend_request_expiration_time`.
         */
        FriendRequestRetentionDuration: PlainDescriptor<bigint>;
        /**
         * Number of blocks between offchain-worker maintenance runs.
         */
        OffchainWorkerInterval: PlainDescriptor<number>;
        /**
         * The duration of a long-term storage claiming period, in seconds.
         *
         * Time is divided into fixed-duration periods. The period index is computed as
         * `now_secs / LongTermStoragePeriodDuration`. Each person can submit up to
         * `LongTermStorageClaimsPerPeriod` claims per period.
         */
        LongTermStoragePeriodDuration: PlainDescriptor<number>;
        /**
         * Maximum number of long-term storage claims per person per period.
         *
         * Each claim uses a different counter value (0..claims_per_period) which produces a
         * distinct alias in the proof context, ensuring one claim per counter slot.
         */
        LongTermStorageClaimsPerPeriod: PlainDescriptor<number>;
        /**
         * Extra time, in seconds, during which the previous long-term storage period is still
         * accepted after a rollover.
         *
         * Same semantics as `FriendRequestGraceWindow` but applied to long-term storage claims.
         */
        LongTermStorageGraceWindow: PlainDescriptor<number>;
        /**
         * Maximum number of spent long-term storage aliases that can be cleared in a single
         * `clear_expired_long_term_storage_aliases` call.
         *
         * Bounds the worst-case weight of the cleanup extrinsic; callers must pass a `limit`
         * no greater than this value.
         */
        LongTermStorageCleanupLimit: PlainDescriptor<number>;
    };
    ChunksManager: {
        /**
         * Number of chunks per page. Must be a power of two.
         */
        PageSize: PlainDescriptor<number>;
    };
    Members: {
        /**
         * Maximum number of collections an owner can have.
         */
        MaxCollections: PlainDescriptor<number>;
        /**
         * Maximum number of members included in an onboarding queue page before a new one is
         * created.
         */
        OnboardingQueuePageSize: PlainDescriptor<number>;
        /**
         * The maximum ring exponent used for Flexible collections. This also determines the page
         * size for paginated ring key storage. Flexible collections can only use ring sizes up
         * to this value.
         */
        MaxFlexibleRingExponent: PlainDescriptor<Anonymize<Idvob66qflhcgd>>;
        /**
         * Maximum number of members that can be included in a ring through a single root building
         * call.
         */
        RingBuildingMemberLimit: PlainDescriptor<number>;
        /**
         * Duration in seconds that old ring roots are retained before they can be cleaned up.
         * This allows proofs generated with older roots to remain valid for a grace period.
         */
        OldRootRetentionDuration: PlainDescriptor<bigint>;
        /**
         * The number of blocks between offchain worker executions.
         */
        OffchainWorkerInterval: PlainDescriptor<number>;
    };
    Coinage: {
        /**
         * The ring exponent for recycler collections.
         */
        RecyclerRingExponent: PlainDescriptor<Anonymize<Idvob66qflhcgd>>;
        /**
         * The ring exponent for paid unload token collections.
         */
        PaidUnloadTokenRingExponent: PlainDescriptor<Anonymize<Idvob66qflhcgd>>;
        /**
         * The unit of the underlying asset of the coins.
         */
        UnderlyingAssetUnit: PlainDescriptor<bigint>;
        /**
         * The minimum exponent for the coin value.
         */
        MinimumExponent: PlainDescriptor<number>;
        /**
         * The maximum exponent for the coin value.
         */
        MaximumExponent: PlainDescriptor<number>;
        /**
         * The minimum coin exponent that can be used to dispatch a call `unload_recycler_*` with
         * the transaction extension `AsUnloadTokenFromOutput`.
         *
         * This ensures the fee coin is large enough to penalize failing transactions, but it does
         * not need to cover the whole unload token fee.
         *
         * The helper function `weight_for_unload_recycler_paying_using_output` can be used to
         * evaluate the worst-case weight for this operation.
         */
        MinimumExponentForOutputUnloadFee: PlainDescriptor<number>;
        /**
         * The maximum number of outputs for a split.
         */
        MaxSplitOutputs: PlainDescriptor<number>;
        /**
         * The maximum number of alias proofs in a consolidation.
         */
        MaxConsolidation: PlainDescriptor<number>;
        /**
         * The maximum number of inner calls in a single
         * [`Call::load_recycler_with_external_asset_unpaid_batch`] dispatch.
         */
        MaxBatchUnpaidLoad: PlainDescriptor<number>;
        /**
         * The time period duration for unload tokens, in seconds.
         */
        UnloadTokenTimePeriodPeopleLitePeople: PlainDescriptor<number>;
        /**
         * The allowance of unload tokens that a person can use per time period, expressed in the
         * underlying asset.
         *
         * Use pallet view to fetch the corresponding number of unload tokens given the current
         * price for unload tokens.
         */
        UnloadTokenAllowancePerTimePeriodForPeople: PlainDescriptor<bigint>;
        /**
         * The allowance of unload tokens that a lite person can use per time period, expressed in
         * the underlying asset.
         *
         * Use pallet's get_free_unload_token_info() to fetch the corresponding number of unload
         * tokens given the current price for unload tokens.
         */
        UnloadTokenAllowancePerTimePeriodForLitePeople: PlainDescriptor<bigint>;
        /**
         * Hard upper bound on the number of free unload tokens per time period.
         *
         * The effective free token limit is:
         * `min(allowance / current_fee, MaxFreeUnloadTokensPerTimePeriod)`.
         */
        MaxFreeUnloadTokensPerTimePeriod: PlainDescriptor<number>;
        /**
         * The number of blocks between offchain worker executions.
         */
        OffchainWorkerInterval: PlainDescriptor<number>;
        /**
         * The base number of seconds to lock a coin after a failed dispatch in `AsCoin` flow.
         *
         * The actual lock duration is exponential: `2^retries * base` where `retries` is
         * the number of consecutive failures.
         */
        CoinFailureLockPeriod: PlainDescriptor<bigint>;
        /**
         * The account id of the pallet.
         */
        pallet_account: PlainDescriptor<SS58String>;
    };
    MembersNotifier: {
        /**
         * Maximum number of subscribers allowed.
         */
        MaxSubscribers: PlainDescriptor<number>;
        /**
         * Maximum updates per batch.
         */
        MaxUpdatesPerBatch: PlainDescriptor<number>;
        /**
         * Maximum collections a subscriber can subscribe to.
         */
        MaxCollectionsPerSubscriber: PlainDescriptor<number>;
        /**
         * Maximum number of ring collections.
         */
        MaxCollections: PlainDescriptor<number>;
        /**
         * Minimum number of blocks between update batches.
         */
        UpdateTriggerBlocks: PlainDescriptor<number>;
        /**
         * Minimum number of updates to trigger immediate batch send.
         */
        UpdateTriggerThreshold: PlainDescriptor<number>;
        /**
         * Per-index weight surcharge for remote execution on the subscriber chain.
         */
        RequestReplayRemoteWeight: PlainDescriptor<Anonymize<I4q39t5hn830vp>>;
        /**
         * Minimum number of blocks between offchain worker runs.
         */
        OffchainWorkerInterval: PlainDescriptor<number>;
        /**
         * Number of blocks after which a stuck batch is abandoned.
         */
        StuckBatchTimeout: PlainDescriptor<number>;
        /**
         * Cooldown, in seconds, between replay requests for the same subscriber and collection.
         */
        ReplayCooldownSeconds: PlainDescriptor<bigint>;
    };
    Airdrop: {
        /**
         * Pallet id used to derive the prize pot account.
         */
        PalletId: PlainDescriptor<SizedHex<8>>;
        /**
         * Maximum number of registration entries processed per
         * `clean_up_{registrations,winners}_authorized` invocation.
         */
        ClearLimit: PlainDescriptor<number>;
        /**
         * Maximum number of winner slots inserted per `draw_winners_authorized` call.
         */
        DrawLimit: PlainDescriptor<number>;
        /**
         * How frequently the offchain worker fires (in blocks).
         */
        OffchainWorkerInterval: PlainDescriptor<number>;
        /**
         * Account id of the prize pot.
         */
        airdrop_pot_id: PlainDescriptor<SS58String>;
    };
    Honour: {
        /**
         * Duration in seconds that must pass before a point can be reused.
         */
        PointFreezeDuration: PlainDescriptor<bigint>;
        /**
         * Duration in seconds a `bestow` call remains valid after its `call_valid_from`.
         */
        CallMortality: PlainDescriptor<bigint>;
    };
    MultiBlockMigrations: {
        /**
         * The maximal length of an encoded cursor.
         *
         * A good default needs to selected such that no migration will ever have a cursor with MEL
         * above this limit. This is statically checked in `integrity_test`.
         */
        CursorMaxLen: PlainDescriptor<number>;
        /**
         * The maximal length of an encoded identifier.
         *
         * A good default needs to selected such that no migration will ever have an identifier
         * with MEL above this limit. This is statically checked in `integrity_test`.
         */
        IdentifierMaxLen: PlainDescriptor<number>;
    };
};
type IViewFns = {
    Assets: {
        /**
         * Provide the asset details for asset `id`.
         */
        asset_details: RuntimeDescriptor<[id: Anonymize<If9iqq7i64mur8>], Anonymize<I6052turo9tavh>>;
        /**
         * Provide the balance of `who` for asset `id`.
         */
        balance_of: RuntimeDescriptor<[who: SS58String, id: Anonymize<If9iqq7i64mur8>], Anonymize<I35p85j063s0il>>;
        /**
         * Provide the configured metadata for asset `id`.
         */
        get_metadata: RuntimeDescriptor<[id: Anonymize<If9iqq7i64mur8>], Anonymize<Iemk0s5gdc9ruv>>;
        /**
         * Provide the configured reserves data for asset `id`.
         */
        get_reserves_data: RuntimeDescriptor<[id: Anonymize<If9iqq7i64mur8>], Anonymize<If2801grpltbp8>>;
    };
    Proxy: {
        /**
         * Check if a `RuntimeCall` is allowed for a given `ProxyType`.
         */
        check_permissions: RuntimeDescriptor<[call: Anonymize<Ierfo0k32c1e50>, proxy_type: Anonymize<Ieuemnllefri8h>], boolean>;
        /**
         * Check if one `ProxyType` is a subset of another `ProxyType`.
         */
        is_superset: RuntimeDescriptor<[to_check: Anonymize<Ieuemnllefri8h>, against: Anonymize<Ieuemnllefri8h>], boolean>;
    };
    Resources: {
        /**
         * Returns the current statement store allowance period (day number since Unix epoch).
         */
        current_stmt_store_period: RuntimeDescriptor<[], number>;
        /**
         * Returns the proof context for a statement store slot claim at the given
         * `period` and `seq`.
         *
         * Layout: `SSS_SLOT:<period (4 bytes BE)><seq (4 bytes BE)>` padded to 32 bytes.
         */
        stmt_store_slot_context_for: RuntimeDescriptor<[period: number, seq: number], SizedHex<32>>;
        /**
         * Returns the proof context for a friend request registration at the given
         * `period` and `seq`.
         */
        friend_request_context_for: RuntimeDescriptor<[period: number, seq: number], SizedHex<32>>;
    };
    Coinage: {
        /**
         * Get the current number of free unload tokens distributed to people and lite people
         * given the current price for unload tokens.
         *
         * If an element is `None`, no price is currently available and conversion between native
         * and the underlying asset needs to be configured.
         *
         * Returns: `(limit_people, limit_lite_people)`.
         *
         * Each element is `None` when its limit cannot be computed.
         */
        get_free_unload_token_info: RuntimeDescriptor<[], Anonymize<Iavc33atjrmdmp>>;
        /**
         * Get the ring status for a recycler at a given ring index.
         */
        get_recycler_ring_status: RuntimeDescriptor<[value: number, index: number], Anonymize<I596b7bbfu4tap>>;
        /**
         * Get the ring revision for a recycler at a given ring index.
         */
        get_recycler_ring_revision: RuntimeDescriptor<[value: number, index: number], Anonymize<I4arjljr6dpflb>>;
        /**
         * Get the ring status for a paid token at a given period and ring index.
         */
        get_paid_token_ring_status: RuntimeDescriptor<[period: number, index: number], Anonymize<I596b7bbfu4tap>>;
        /**
         * Get the ring revision for a paid token at a given period and ring index.
         */
        get_paid_token_ring_revision: RuntimeDescriptor<[period: number, index: number], Anonymize<I4arjljr6dpflb>>;
        /**
         * Get the current fee in the underlying asset for paid unload tokens.
         *
         * If none is returned it means that no price is currently available, and some conversion
         * between native and the underlying asset needs to be configured.
         */
        get_paid_unload_token_fee_in_asset: RuntimeDescriptor<[], Anonymize<I35p85j063s0il>>;
        /**
         * Get the current fee in the native currency for paid unload tokens.
         */
        get_paid_unload_token_fee_in_native: RuntimeDescriptor<[], bigint>;
        /**
         * Get coin details for an account.
         */
        get_coin_by_owner: RuntimeDescriptor<[owner: SS58String], Anonymize<Ia4n949ohqh8lm>>;
        /**
         * Get the Unix timestamp until which a coin is currently locked after failed dispatch.
         *
         * Returns `None` when there is no lock or when the stored lock has already expired.
         */
        get_coin_lock_until: RuntimeDescriptor<[owner: SS58String], Anonymize<I35p85j063s0il>>;
        /**
         * Get the coin value for a specific recycler member key.
         */
        get_recycler_member_info: RuntimeDescriptor<[member: SizedHex<32>], Anonymize<I4arjljr6dpflb>>;
        /**
         * Check whether a paid token member key is registered.
         */
        is_paid_token_member: RuntimeDescriptor<[member: SizedHex<32>], boolean>;
        /**
         * Get the members of a recycler ring (the anonymity set).
         * Required to build the ring commitment (accumulator) for the proof.
         */
        get_recycler_members: RuntimeDescriptor<[value: number, index: number], Anonymize<Ic5m5lp1oioo8r>>;
        /**
         * Get the members of a paid token ring (the anonymity set).
         * Required to build the ring commitment (accumulator) for the proof.
         */
        get_paid_token_ring_members: RuntimeDescriptor<[period: number, index: number], Anonymize<Ic5m5lp1oioo8r>>;
        /**
         * Check if a recycler alias has already been unloaded (spent).
         *
         * If the recycler is not live, the result is not significant.
         */
        is_recycler_alias_unloaded: RuntimeDescriptor<[value: number, index: number, alias: SizedHex<32>], boolean>;
        /**
         * Check if a paid unload token has been consumed.
         *
         * If the period is not current, the result is not significant.
         */
        is_paid_token_alias_consumed: RuntimeDescriptor<[period: number, index: number, alias: SizedHex<32>], boolean>;
        /**
         * Check if a free unload token has been consumed.
         *
         * If the period is not current, the result is not significant.
         */
        is_free_token_alias_consumed: RuntimeDescriptor<[period: number, alias: SizedHex<32>], boolean>;
        /**
         * Get the worst-case weight for a transaction using output-based fee payment.
         *
         * This function returns the maximum weight for transactions dispatched with
         * `AsUnloadTokenFromOutput`, useful for runtime configuration to find a good value for
         * `MinimumExponentForOutputUnloadFee`.
         */
        weight_for_unload_recycler_paying_using_output: RuntimeDescriptor<[], Anonymize<I4q39t5hn830vp>>;
    };
    MultiBlockMigrations: {
        /**
         * Returns the ongoing status of migrations.
         */
        ongoing_status: RuntimeDescriptor<[], Anonymize<I9vodnt2k1kha>>;
        /**
         * Returns progress information about the current migration, if any.
         *
         * This function provides detailed information about the current migration's progress,
         * including the number of steps completed and the maximum allowed steps.
         */
        progress: RuntimeDescriptor<[], Anonymize<I4ao1le27fcisl>>;
        /**
         * Returns the storage prefixes affected by the current migration.
         *
         * Can be empty if the migration does not know or there are no prefixes.
         */
        affected_prefixes: RuntimeDescriptor<[], Anonymize<Itom7fk49o0c9>>;
        /**
         * Returns the comprehensive status of multi-block migrations.
         */
        status: RuntimeDescriptor<[], Anonymize<Ih4ursllob8fg>>;
    };
};
type IRuntimeCalls = {
    /**
     * API necessary for block authorship with aura.
     */
    AuraApi: {
        /**
         * Returns the slot duration for Aura.
         *
         * Currently, only the value provided by this type at genesis will be used.
         */
        slot_duration: RuntimeDescriptor<[], bigint>;
        /**
         * Return the current set of authorities.
         */
        authorities: RuntimeDescriptor<[], Anonymize<Ic5m5lp1oioo8r>>;
    };
    /**
     * API to tell the node side how the relay parent should be chosen.
     *
     * A larger offset indicates that the relay parent should not be the tip of the relay chain,
     * but `N` blocks behind the tip. This offset is then enforced by the runtime.
     */
    RelayParentOffsetApi: {
        /**
         * Fetch the slot offset that is expected from the relay chain.
         */
        relay_parent_offset: RuntimeDescriptor<[], number>;
    };
    /**
     * This runtime API is used to inform potential block authors whether they will
     * have the right to author at a slot, assuming they have claimed the slot.
     *
     * In particular, this API allows Aura-based parachains to regulate their "unincluded segment",
     * which is the section of the head of the chain which has not yet been made available in the
     * relay chain.
     *
     * When the unincluded segment is short, Aura chains will allow authors to create multiple
     * blocks per slot in order to build a backlog. When it is saturated, this API will limit
     * the amount of blocks that can be created.
     *
     * Changes:
     * - Version 2: Update to `can_build_upon` to take a relay chain `Slot` instead of a parachain `Slot`.
     */
    AuraUnincludedSegmentApi: {
        /**
         * Whether it is legal to extend the chain, assuming the given block is the most
         * recently included one as-of the relay parent that will be built against, and
         * the given relay chain slot.
         *
         * This should be consistent with the logic the runtime uses when validating blocks to
         * avoid issues.
         *
         * When the unincluded segment is empty, i.e. `included_hash == at`, where at is the block
         * whose state we are querying against, this must always return `true` as long as the slot
         * is more recent than the included block itself.
         */
        can_build_upon: RuntimeDescriptor<[included_hash: SizedHex<32>, slot: bigint], boolean>;
    };
    /**
     * The `Core` runtime api that every Substrate runtime needs to implement.
     */
    Core: {
        /**
         * Returns the version of the runtime.
         */
        version: RuntimeDescriptor<[], Anonymize<I4fo08joqmcqnm>>;
        /**
         * Execute the given block.
         */
        execute_block: RuntimeDescriptor<[block: Anonymize<Iaqet9jc3ihboe>], undefined>;
        /**
         * Initialize a block with the given header and return the runtime executive mode.
         */
        initialize_block: RuntimeDescriptor<[header: Anonymize<Ic952bubvq4k7d>], Anonymize<I2v50gu3s1aqk6>>;
    };
    /**
     * The `Metadata` api trait that returns metadata for the runtime.
     */
    Metadata: {
        /**
         * Returns the metadata of a runtime.
         */
        metadata: RuntimeDescriptor<[], Uint8Array>;
        /**
         * Returns the metadata at a given version.
         *
         * If the given `version` isn't supported, this will return `None`.
         * Use [`Self::metadata_versions`] to find out about supported metadata version of the runtime.
         */
        metadata_at_version: RuntimeDescriptor<[version: number], Anonymize<Iabpgqcjikia83>>;
        /**
         * Returns the supported metadata versions.
         *
         * This can be used to call `metadata_at_version`.
         */
        metadata_versions: RuntimeDescriptor<[], Anonymize<Icgljjb6j82uhn>>;
    };
    /**
     * Runtime API for executing view functions
     */
    RuntimeViewFunction: {
        /**
         * Execute a view function query.
         */
        execute_view_function: RuntimeDescriptor<[query_id: Anonymize<I4gil44d08grh>, input: Uint8Array], Anonymize<I7u915mvkdsb08>>;
    };
    /**
     * The `BlockBuilder` api trait that provides the required functionality for building a block.
     */
    BlockBuilder: {
        /**
         * Apply the given extrinsic.
         *
         * Returns an inclusion outcome which specifies if this extrinsic is included in
         * this block or not.
         */
        apply_extrinsic: RuntimeDescriptor<[extrinsic: Uint8Array], Anonymize<I4s8jc79vpdfj8>>;
        /**
         * Finish the current block.
         */
        finalize_block: RuntimeDescriptor<[], Anonymize<Ic952bubvq4k7d>>;
        /**
         * Generate inherent extrinsics. The inherent data will vary from chain to chain.
         */
        inherent_extrinsics: RuntimeDescriptor<[inherent: Anonymize<If7uv525tdvv7a>], Anonymize<Itom7fk49o0c9>>;
        /**
         * Check that the inherents are valid. The inherent data will vary from chain to chain.
         */
        check_inherents: RuntimeDescriptor<[block: Anonymize<Iaqet9jc3ihboe>, data: Anonymize<If7uv525tdvv7a>], Anonymize<I2an1fs2eiebjp>>;
    };
    /**
     * The `TaggedTransactionQueue` api trait for interfering with the transaction queue.
     */
    TaggedTransactionQueue: {
        /**
         * Validate the transaction.
         *
         * This method is invoked by the transaction pool to learn details about given transaction.
         * The implementation should make sure to verify the correctness of the transaction
         * against current state. The given `block_hash` corresponds to the hash of the block
         * that is used as current state.
         *
         * Note that this call may be performed by the pool multiple times and transactions
         * might be verified in any possible order.
         */
        validate_transaction: RuntimeDescriptor<[source: TransactionValidityTransactionSource, tx: Uint8Array, block_hash: SizedHex<32>], Anonymize<I9ask1o4tfvcvs>>;
    };
    /**
     * The offchain worker api.
     */
    OffchainWorkerApi: {
        /**
         * Starts the off-chain task for given block header.
         */
        offchain_worker: RuntimeDescriptor<[header: Anonymize<Ic952bubvq4k7d>], undefined>;
    };
    /**
     * Session keys runtime api.
     */
    SessionKeys: {
        /**
         * Generate a set of session keys with optionally using the given seed.
         * The keys should be stored within the keystore exposed via runtime
         * externalities.
         *
         * The seed needs to be a valid `utf8` string.
         *
         * Returns the concatenated SCALE encoded public keys.
         */
        generate_session_keys: RuntimeDescriptor<[owner: Uint8Array, seed: Anonymize<Iabpgqcjikia83>], Anonymize<I4ph3d1eepnmr1>>;
        /**
         * Decode the given public session keys.
         *
         * Returns the list of public raw public keys + key type.
         */
        decode_session_keys: RuntimeDescriptor<[encoded: Uint8Array], Anonymize<Icerf8h8pdu8ss>>;
    };
    /**
     * The API to query account nonce.
     */
    AccountNonceApi: {
        /**
         * Get current account nonce of given `AccountId`.
         */
        account_nonce: RuntimeDescriptor<[account: SS58String], number>;
    };
    /**
    
     */
    TransactionPaymentApi: {
        /**
        
         */
        query_info: RuntimeDescriptor<[uxt: Uint8Array, len: number], Anonymize<I6spmpef2c7svf>>;
        /**
        
         */
        query_fee_details: RuntimeDescriptor<[uxt: Uint8Array, len: number], Anonymize<Iei2mvq0mjvt81>>;
        /**
        
         */
        query_weight_to_fee: RuntimeDescriptor<[weight: Anonymize<I4q39t5hn830vp>], bigint>;
        /**
        
         */
        query_length_to_fee: RuntimeDescriptor<[length: number], bigint>;
    };
    /**
    
     */
    TransactionPaymentCallApi: {
        /**
         * Query information of a dispatch class, weight, and fee of a given encoded `Call`.
         */
        query_call_info: RuntimeDescriptor<[call: Anonymize<Ierfo0k32c1e50>, len: number], Anonymize<I6spmpef2c7svf>>;
        /**
         * Query fee details of a given encoded `Call`.
         */
        query_call_fee_details: RuntimeDescriptor<[call: Anonymize<Ierfo0k32c1e50>, len: number], Anonymize<Iei2mvq0mjvt81>>;
        /**
         * Query the output of the current `WeightToFee` given some input.
         */
        query_weight_to_fee: RuntimeDescriptor<[weight: Anonymize<I4q39t5hn830vp>], bigint>;
        /**
         * Query the output of the current `LengthToFee` given some input.
         */
        query_length_to_fee: RuntimeDescriptor<[length: number], bigint>;
    };
    /**
     * A trait of XCM payment API.
     *
     * API provides functionality for obtaining:
     *
     * * the weight required to execute an XCM message,
     * * a list of acceptable `AssetId`s for message execution payment,
     * * the cost of the weight in the specified acceptable `AssetId`.
     * * the fees for an XCM message delivery.
     *
     * To determine the execution weight of the calls required for
     * [`xcm::latest::Instruction::Transact`] instruction, `TransactionPaymentCallApi` can be used.
     */
    XcmPaymentApi: {
        /**
         * Returns a list of acceptable payment assets.
         *
         * # Arguments
         *
         * * `xcm_version`: Version.
         */
        query_acceptable_payment_assets: RuntimeDescriptor<[xcm_version: number], Anonymize<Iftvbctbo05fu4>>;
        /**
         * Returns a weight needed to execute a XCM.
         *
         * # Arguments
         *
         * * `message`: `VersionedXcm`.
         */
        query_xcm_weight: RuntimeDescriptor<[message: XcmVersionedXcm], Anonymize<Ic0c3req3mlc1l>>;
        /**
         * Converts a weight into a fee for the specified `AssetId`.
         *
         * # Arguments
         *
         * * `weight`: convertible `Weight`.
         * * `asset`: `VersionedAssetId`.
         */
        query_weight_to_asset_fee: RuntimeDescriptor<[weight: Anonymize<I4q39t5hn830vp>, asset: XcmVersionedAssetId], Anonymize<I7ocn4njqde3v5>>;
        /**
         * Query delivery fees V2.
         *
         * Get delivery fees for sending a specific `message` to a `destination`.
         * These always come in a specific asset, defined by the chain.
         *
         * # Arguments
         * * `message`: The message that'll be sent, necessary because most delivery fees are based on the
         * size of the message.
         * * `destination`: The destination to send the message to. Different destinations may use
         * different senders that charge different fees.
         */
        query_delivery_fees: RuntimeDescriptor<[destination: XcmVersionedLocation, message: XcmVersionedXcm, asset_id: XcmVersionedAssetId], Anonymize<Iek7ha36da9mf5>>;
    };
    /**
     * API for dry-running extrinsics and XCM programs to get the programs that need to be passed to the fees API.
     *
     * All calls return a vector of tuples (location, xcm) where each "xcm" is executed in "location".
     * If there's local execution, the location will be "Here".
     * This vector can be used to calculate both execution and delivery fees.
     *
     * Calls or XCMs might fail when executed, this doesn't mean the result of these calls will be an `Err`.
     * In those cases, there might still be a valid result, with the execution error inside it.
     * The only reasons why these calls might return an error are listed in the [`Error`] enum.
     */
    DryRunApi: {
        /**
         * Dry run call V2.
         */
        dry_run_call: RuntimeDescriptor<[origin: Anonymize<I2vjn8o312puvk>, call: Anonymize<Ierfo0k32c1e50>, result_xcms_version: number], Anonymize<I1nnit8gqdhb62>>;
        /**
         * Dry run XCM program
         */
        dry_run_xcm: RuntimeDescriptor<[origin_location: XcmVersionedLocation, xcm: XcmVersionedXcm], Anonymize<I60k51mebtj8tr>>;
    };
    /**
     * API for useful conversions between XCM `Location` and `AccountId`.
     */
    LocationToAccountApi: {
        /**
         * Converts `Location` to `AccountId`.
         */
        convert_location: RuntimeDescriptor<[location: XcmVersionedLocation], Anonymize<Ieh6nis3hdbtgi>>;
    };
    /**
     * The API to query the rewards for mob credit.
     */
    MobRuleApi: {
        /**
         * Returns a list of cases where the user has a vote stored on chain. If the `done_only`
         * flag is set, only cases that are done and ready to be claimed will be returned. This
         * function does not take the correctness of the vote into account.
         */
        voted_on: RuntimeDescriptor<[voter: SizedHex<32>, done_only: boolean], Anonymize<Icgljjb6j82uhn>>;
    };
    /**
     * The API to query the deposit for a proof of ink candidacy.
     */
    ProofOfInkApi: {
        /**
         * Returns the deposit necessary to become a candidate.
         */
        candidacy_deposit: RuntimeDescriptor<[], bigint>;
    };
    /**
     * The API to query the deposit for gameplay.
     */
    PalletGameApi: {
        /**
         * Returns the deposit necessary to play a game.
         */
        play_deposit: RuntimeDescriptor<[], bigint>;
    };
    /**
     * Runtime api to collect information about a collation.
     *
     * Version history:
     * - Version 2: Changed [`Self::collect_collation_info`] signature
     * - Version 3: Signals to the node to use version 1 of [`ParachainBlockData`].
     */
    CollectCollationInfo: {
        /**
         * Collect information about a collation.
         *
         * The given `header` is the header of the built block for that
         * we are collecting the collation info for.
         */
        collect_collation_info: RuntimeDescriptor<[header: Anonymize<Ic952bubvq4k7d>], Anonymize<Ic1d4u2opv3fst>>;
    };
    /**
     * API to interact with `RuntimeGenesisConfig` for the runtime
     */
    GenesisBuilder: {
        /**
         * Build `RuntimeGenesisConfig` from a JSON blob not using any defaults and store it in the
         * storage.
         *
         * In the case of a FRAME-based runtime, this function deserializes the full
         * `RuntimeGenesisConfig` from the given JSON blob and puts it into the storage. If the
         * provided JSON blob is incorrect or incomplete or the deserialization fails, an error
         * is returned.
         *
         * Please note that provided JSON blob must contain all `RuntimeGenesisConfig` fields, no
         * defaults will be used.
         */
        build_state: RuntimeDescriptor<[json: Uint8Array], Anonymize<Ie9sr1iqcg3cgm>>;
        /**
         * Returns a JSON blob representation of the built-in `RuntimeGenesisConfig` identified by
         * `id`.
         *
         * If `id` is `None` the function should return JSON blob representation of the default
         * `RuntimeGenesisConfig` struct of the runtime. Implementation must provide default
         * `RuntimeGenesisConfig`.
         *
         * Otherwise function returns a JSON representation of the built-in, named
         * `RuntimeGenesisConfig` preset identified by `id`, or `None` if such preset does not
         * exist. Returned `Vec<u8>` contains bytes of JSON blob (patch) which comprises a list of
         * (potentially nested) key-value pairs that are intended for customizing the default
         * runtime genesis config. The patch shall be merged (rfc7386) with the JSON representation
         * of the default `RuntimeGenesisConfig` to create a comprehensive genesis config that can
         * be used in `build_state` method.
         */
        get_preset: RuntimeDescriptor<[id: Anonymize<I1mqgk2tmnn9i2>], Anonymize<Iabpgqcjikia83>>;
        /**
         * Returns a list of identifiers for available builtin `RuntimeGenesisConfig` presets.
         *
         * The presets from the list can be queried with [`GenesisBuilder::get_preset`] method. If
         * no named presets are provided by the runtime the list is empty.
         */
        preset_names: RuntimeDescriptor<[], Anonymize<I6lr8sctk0bi4e>>;
    };
};
export type PaseoPeopleNextDispatchError = Anonymize<I8rjgvnsb8ltnm>;
type IAsset = PlainDescriptor<Anonymize<If9iqq7i64mur8>>;
export type PaseoPeopleNextExtensions = {
    "AuthorizeValueTransfer": {
        value: Anonymize<I40k710moo3ghm>;
    };
    "VerifyMultiSignature": {
        value: Anonymize<Id3vovj0ihlrsb>;
    };
    "AsPerson": {
        value: Anonymize<I6i9m7o2et1j4d>;
    };
    "AsProofOfInkParticipant": {
        value: Anonymize<I4rnuci7kia2r1>;
    };
    "ScoreAsParticipant": {
        value: Anonymize<I4arjljr6dpflb>;
    };
    "GameAsInvited": {
        value: Anonymize<I6k0juar2doko8>;
    };
    "PeopleLiteAuth": {
        value: Anonymize<I9187oseptvbg4>;
    };
    "AsMember": {
        value: Anonymize<Id5fnv3e135pfi>;
    };
    "AsCoinage": {
        value: Anonymize<I7ohvr4mqgjtpu>;
    };
    "AsResources": {
        value: Anonymize<I1aakk85jiarum>;
    };
    "HonourAuth": {
        value: Anonymize<Ie5q72utgevbaq>;
    };
    "RestrictOrigins": {
        value: boolean;
    };
};
type PalletsTypedef = {
    __storage: IStorage;
    __tx: ICalls;
    __event: IEvent;
    __error: IError;
    __const: IConstants;
    __view: IViewFns;
};
export type PaseoPeopleNext = {
    descriptors: {
        pallets: PalletsTypedef;
        apis: IRuntimeCalls;
    } & Promise<any>;
    metadataTypes: Promise<Uint8Array>;
    asset: IAsset;
    extensions: PaseoPeopleNextExtensions;
    getMetadata: () => Promise<Uint8Array>;
    genesis: string | undefined;
};
declare const _allDescriptors: PaseoPeopleNext;
export default _allDescriptors;
export type PaseoPeopleNextApis = ApisFromDef<IRuntimeCalls>;
export type PaseoPeopleNextQueries = QueryFromPalletsDef<PalletsTypedef>;
export type PaseoPeopleNextCalls = TxFromPalletsDef<PalletsTypedef>;
export type PaseoPeopleNextEvents = EventsFromPalletsDef<PalletsTypedef>;
export type PaseoPeopleNextErrors = ErrorsFromPalletsDef<PalletsTypedef>;
export type PaseoPeopleNextConstants = ConstFromPalletsDef<PalletsTypedef>;
export type PaseoPeopleNextViewFns = ViewFnsFromPalletsDef<PalletsTypedef>;
export type PaseoPeopleNextCallData = Anonymize<Ierfo0k32c1e50> & {
    value: {
        type: string;
    };
};
type AllInteractions = {
    storage: {
        System: ['Account', 'ExtrinsicCount', 'InherentsApplied', 'BlockWeight', 'BlockSize', 'BlockHash', 'ExtrinsicData', 'Number', 'ParentHash', 'Digest', 'Events', 'EventCount', 'EventTopics', 'LastRuntimeUpgrade', 'BlocksTillUpgrade', 'UpgradedToU32RefCount', 'UpgradedToTripleRefCount', 'ExecutionPhase', 'AuthorizedUpgrade', 'ExtrinsicWeightReclaimed'];
        ParachainSystem: ['BlockWeightMode', 'PreviousCoreCount', 'UnincludedSegment', 'AggregatedUnincludedSegment', 'PendingValidationCode', 'NewValidationCode', 'ValidationData', 'DidSetValidationCode', 'LastRelayChainBlockNumber', 'UpgradeRestrictionSignal', 'UpgradeGoAhead', 'RelayStateProof', 'RelevantMessagingState', 'HostConfiguration', 'LastDmqMqcHead', 'LastHrmpMqcHeads', 'ProcessedDownwardMessages', 'LastProcessedDownwardMessage', 'HrmpWatermark', 'LastProcessedHrmpMessage', 'HrmpOutboundMessages', 'UpwardMessages', 'PendingUpwardMessages', 'PendingUpwardSignals', 'PendingApprovedPeer', 'UpwardDeliveryFeeFactor', 'AnnouncedHrmpMessagesPerCandidate', 'ReservedXcmpWeightOverride', 'ReservedDmpWeightOverride', 'CustomValidationHeadData', 'PoVMessagesTracker'];
        Timestamp: ['Now', 'DidUpdate'];
        ParachainInfo: ['ParachainId'];
        Balances: ['TotalIssuance', 'InactiveIssuance', 'Account', 'Locks', 'Reserves', 'Holds', 'Freezes'];
        TransactionPayment: ['NextFeeMultiplier', 'StorageVersion', 'TxPaymentCredit'];
        OriginRestriction: ['Usages'];
        Assets: ['Asset', 'Account', 'Approvals', 'Metadata', 'Reserves', 'NextAssetId'];
        AssetsHolder: ['Holds', 'BalancesOnHold'];
        AssetRate: ['ConversionRateToNative'];
        Authorship: ['Author'];
        CollatorSelection: ['Invulnerables', 'CandidateList', 'LastAuthoredBlock', 'DesiredCandidates', 'CandidacyBond'];
        Session: ['Validators', 'CurrentIndex', 'QueuedChanged', 'QueuedKeys', 'DisabledValidators', 'NextKeys', 'KeyOwner', 'ExternallySetKeys'];
        Aura: ['Authorities', 'CurrentSlot'];
        AuraExt: ['Authorities', 'RelaySlotInfo'];
        XcmpQueue: ['InboundXcmpSuspended', 'OutboundXcmpStatus', 'OutboundXcmpMessages', 'SignalMessages', 'QueueConfig', 'QueueSuspended', 'DeliveryFeeFactor'];
        PolkadotXcm: ['QueryCounter', 'Queries', 'AssetTraps', 'SafeXcmVersion', 'SupportedVersion', 'VersionNotifiers', 'VersionNotifyTargets', 'VersionDiscoveryQueue', 'CurrentMigration', 'RemoteLockedFungibles', 'LockedFungibles', 'XcmExecutionSuspended', 'ShouldRecordXcm', 'RecordedXcm', 'AuthorizedAliases'];
        MessageQueue: ['BookStateFor', 'ServiceHead', 'Pages'];
        Multisig: ['Multisigs'];
        Sudo: ['Key'];
        Proxy: ['Proxies', 'Announcements'];
        Identity: ['IdentityOf', 'UsernameOf', 'SuperOf', 'SubsOf', 'Registrars', 'AuthorityOf', 'UsernameInfoOf', 'PendingUsernames', 'UnbindingUsernames', 'PersonIdentities', 'AccountToAlias', 'PendingUsernameReports'];
        People: ['Keys', 'CounterForKeys', 'People', 'AliasToAccount', 'AccountToAlias', 'AccountToPersonalId', 'NextPersonalId', 'PeopleCollectionCreated', 'ReservedPersonalId'];
        MobRule: ['Credits', 'VotingPenalties', 'VotingPoints', 'Votes', 'CaseCount', 'OpenCases', 'RipeCases', 'DoneCases', 'AccumulatedPoints', 'PayoutDistribution', 'RoundSchedules', 'ActiveSince'];
        ProofOfInk: ['Candidates', 'People', 'ReferralTickets', 'DesignFamilies', 'CommittedDesigns', 'AllocationCount', 'Configuration', 'AvailableInvites', 'PendingInvites', 'ReferrerReimbursementValues', 'ReferredReimbursementValues'];
        Game: ['StoredPhaseDurations', 'PlayDepositAmount', 'Nfts', 'NftCandidates', 'ArchivedPlayers', 'Players', 'GameIndex', 'Game', 'GameHistory', 'PlayerAttendanceHistory', 'GameParticipantCount', 'IndexToPlayer', 'PlayerToIndex', 'ShuffleRecognized', 'ShuffleNotRecognized', 'GameSchedules', 'AvailableInvites', 'PendingInvites', 'AliasToStmtAccount', 'StmtAccountToAlias', 'CommunicationIdentifiers'];
        Score: ['Participants', 'PersonhoodThreshold', 'PersonhoodThresholdSchedule', 'AbsenceGraceSchedule', 'AbsenceGraceRatio', 'CurrentRoundPoints', 'CurrentRoundIndex', 'RoundsPointsForParticipant', 'RoundPayouts', 'RoundPlanning', 'RoundSchedules'];
        DummyDim: ['ReservedIds', 'People'];
        PeopleLite: ['LitePeople', 'AliasToAccount', 'AccountToAlias', 'LitePeopleCollectionCreated', 'AttestationAllowance'];
        Resources: ['Consumers', 'StatementStoreAllowances', 'StmtStoreAllowanceByAccount', 'FriendRequestRegistrationByAlias', 'FriendRequestAliasByAccount', 'SpentLongTermStorageAliases', 'UsernameOwnerOf', 'AccountOfAlias', 'UsernameReservationDuration', 'UsernameReservationQueue', 'ReservationOf'];
        ChunksManager: ['Chunks', 'ChunkPageHashes'];
        Members: ['Collections', 'SuspendedCollections', 'IdentifiersOf', 'Root', 'OldRoots', 'CurrentRingIndex', 'OnboardingSize', 'RingKeys', 'RingKeysStatus', 'PendingSuspensions', 'ActiveMembers', 'Members', 'RingsState', 'StaleRings', 'QueuePageIndices', 'OnboardingQueue', 'RingDeletionQueue'];
        Coinage: ['CoinsByOwner', 'LockedCoins', 'TotalValueOfDestroyedCoins', 'ConsumedFreeUnloadTokens', 'RecyclerCollectionCreated', 'RecyclersLastRemovedRingIndex', 'RecyclersCoinToRecycler', 'RecyclersUnloaded', 'RecyclersDusting', 'PaidUnloadTokenMembers', 'PaidUnloadTokenConsumed', 'PaidTokenCollectionsCreated', 'PaidUnloadTokenDusting', 'PaidUnloadTokenNextRingToClean', 'InitializePalletAccount', 'UnderlyingAssetId'];
        MembersNotifier: ['Subscribers', 'CounterForSubscribers', 'SealedBatchSequence', 'PageState', 'PendingUpdates', 'PageUpdatesCount', 'PendingInit', 'CounterForPendingInit', 'SealedBatchIndices', 'CurrentBatch', 'SubscribersWithCurrentBatch', 'LastReplayTime'];
        Airdrop: ['Events', 'ActionSchedule', 'Registrations', 'Winners', 'EventEntropy', 'SupportedAssets'];
        Honour: ['Points', 'Votes', 'Tally'];
        StorageInitialization: ['OnPollStatus', 'XcmTransferInitiatedAt'];
        MultiBlockMigrations: ['Cursor', 'Historic'];
    };
    tx: {
        System: ['remark', 'set_heap_pages', 'set_code', 'set_code_without_checks', 'set_storage', 'kill_storage', 'kill_prefix', 'remark_with_event', 'authorize_upgrade', 'authorize_upgrade_without_checks', 'apply_authorized_upgrade'];
        ParachainSystem: ['set_validation_data', 'sudo_send_upward_message'];
        Timestamp: ['set'];
        Balances: ['transfer_allow_death', 'force_transfer', 'transfer_keep_alive', 'transfer_all', 'force_unreserve', 'upgrade_accounts', 'force_set_balance', 'force_adjust_total_issuance', 'burn'];
        OriginRestriction: ['clean_usage'];
        Assets: ['create', 'force_create', 'start_destroy', 'destroy_accounts', 'destroy_approvals', 'finish_destroy', 'mint', 'burn', 'transfer', 'transfer_keep_alive', 'force_transfer', 'freeze', 'thaw', 'freeze_asset', 'thaw_asset', 'transfer_ownership', 'set_team', 'set_metadata', 'clear_metadata', 'force_set_metadata', 'force_clear_metadata', 'force_asset_status', 'approve_transfer', 'cancel_approval', 'force_cancel_approval', 'transfer_approved', 'touch', 'refund', 'set_min_balance', 'touch_other', 'refund_other', 'block', 'transfer_all', 'set_reserves'];
        AssetRate: ['create', 'update', 'remove'];
        CollatorSelection: ['set_invulnerables', 'set_desired_candidates', 'set_candidacy_bond', 'register_as_candidate', 'leave_intent', 'add_invulnerable', 'remove_invulnerable', 'update_bond', 'take_candidate_slot'];
        Session: ['set_keys', 'purge_keys'];
        XcmpQueue: ['suspend_xcm_execution', 'resume_xcm_execution', 'update_suspend_threshold', 'update_drop_threshold', 'update_resume_threshold'];
        PolkadotXcm: ['send', 'teleport_assets', 'reserve_transfer_assets', 'execute', 'force_xcm_version', 'force_default_xcm_version', 'force_subscribe_version_notify', 'force_unsubscribe_version_notify', 'limited_reserve_transfer_assets', 'limited_teleport_assets', 'force_suspension', 'transfer_assets', 'claim_assets', 'transfer_assets_using_type_and_then', 'add_authorized_alias', 'remove_authorized_alias', 'remove_all_authorized_aliases'];
        MessageQueue: ['reap_page', 'execute_overweight'];
        Utility: ['batch', 'as_derivative', 'batch_all', 'dispatch_as', 'force_batch', 'with_weight', 'if_else', 'dispatch_as_fallible'];
        Multisig: ['as_multi_threshold_1', 'as_multi', 'approve_as_multi', 'cancel_as_multi', 'poke_deposit'];
        Sudo: ['sudo', 'sudo_unchecked_weight', 'set_key', 'sudo_as', 'remove_key'];
        Proxy: ['proxy', 'add_proxy', 'remove_proxy', 'remove_proxies', 'create_pure', 'kill_pure', 'announce', 'remove_announcement', 'reject_announcement', 'proxy_announced', 'poke_deposit'];
        Identity: ['add_registrar', 'set_identity', 'set_subs', 'clear_identity', 'request_judgement', 'cancel_request', 'set_fee', 'set_account_id', 'set_fields', 'provide_judgement', 'kill_identity', 'add_sub', 'rename_sub', 'remove_sub', 'quit_sub', 'add_username_authority', 'remove_username_authority', 'set_username_for', 'accept_username', 'remove_expired_approval', 'set_primary_username', 'unbind_username', 'remove_username', 'kill_username', 'set_personal_identity', 'submit_personal_credential_evidence', 'personal_credential_judged', 'clear_personal_identity', 'report_username', 'reported_username_judged'];
        People: ['under_alias', 'set_alias_account', 'unset_alias_account', 'force_recognize_personhood', 'set_personal_id_account', 'unset_personal_id_account', 'create_people_collection', 'clean_up_stale_aliases'];
        MobRule: ['vote', 'close_case', 'clean_vote', 'reap_case', 'intervene', 'claim_vote', 'payout_rewards', 'claim_votes', 'start_payout_round', 'schedule_payout_rounds', 'remove_payout_schedule', 'claim_credit', 'clean_points', 'force_ripen_case', 'touch_case', 'clear_voting_penalty', 'clean_vote_signed'];
        ProofOfInk: ['apply', 'submit_evidence', 'judged', 'register_referred', 'register_non_referred', 'reroll', 'commit', 'allocate_full', 'timeout', 'flakeout', 'apply_with_signature', 'apply_with_invitation', 'add_design_family', 'set_referral_ticket', 'cancel_referral_ticket', 'register_successful_referral_reward', 'grant_invites', 'remove_available_and_pending_invites', 'set_invite_ticket', 'cancel_invite_ticket', 'set_configuration', 'set_reimbursement_values'];
        Game: ['sign_up_with_invite', 'sign_up_with_account', 'sign_up_with_alias', 'report', 'offboard', 'kickout', 'grant_invites', 'remove_available_and_pending_invites', 'set_invite_ticket', 'cancel_invite_ticket', 'schedule_games', 'remove_scheduled_game', 'set_play_deposit', 'claim_airdrop', 'testnet_force_start_shuffle', 'testnet_force_end_reporting', 'set_game_phases', 'kill_current_game'];
        Score: ['schedule_payout_rounds', 'remove_payout_schedule', 'transition_round', 'operate_payout_round', 'cash_out', 'redeem_credit', 'register', 'set_absence_grace_schedule', 'set_personhood_threshold_schedule'];
        DummyDim: ['reserve_ids', 'renew_id_reservation', 'cancel_id_reservation', 'recognize_personhood', 'suspend_personhood', 'resume_personhood', 'start_mutation_session', 'end_mutation_session'];
        PeopleLite: ['increase_attestation_allowance', 'clear_attestation_allowance', 'attest', 'dispatch_as_signer', 'set_alias_account', 'unset_alias_account'];
        Resources: ['register_lite_person', 'register_person', 'touch_person_authorization', 'remove_expired_username_reservation', 'update_identifier_key', 'set_username_reservation_duration', 'demote_auth_expired', 'set_friend_request_statement_account_for_sequence', 'clear_expired_friend_request_sequence', 'set_statement_store_account', 'clear_expired_stmt_store_allowances', 'claim_long_term_storage', 'clear_expired_long_term_storage_aliases'];
        ChunksManager: ['add_chunks', 'set_chunk_page_hashes'];
        Members: ['merge_rings', 'set_onboarding_size', 'self_include', 'build_ring_authorized', 'onboard_members_authorized', 'merge_queue_pages_authorized', 'remove_suspended_keys_authorized', 'delete_ring_page_authorized', 'enqueue_ring_deletion_authorized', 'delete_onboarding_queue_page_authorized', 'finalize_collection_deletion_authorized', 'mark_ring_stale_authorized', 'clean_up_old_roots_authorized'];
        Coinage: ['split', 'transfer', 'load_recycler_with_coin', 'load_recycler_with_external_asset', 'load_recycler_with_external_asset_unpaid', 'load_recycler_with_external_asset_unpaid_batch', 'unload_recycler_into_coin', 'unload_recycler_into_external_asset', 'pay_for_recycler_unload_fee_token_with_coin', 'pay_for_recycler_unload_fee_token_with_native', 'pay_for_recycler_unload_fee_token_with_stable', 'unload_recycler_into_external_asset_and_vouchers', 'unload_recycler_into_external_asset_non_anonymous', 'unload_recyclers_into_external_asset_non_anonymous', 'unload_recycler_into_coins', 'direct_offboard_coin_into_external_asset', 'set_underlying_asset_id', 'clean_recycler', 'clean_consumed_free_token', 'clean_paid_unload_token_ring', 'clean_recycler_dust', 'clean_paid_unload_token_dust', 'delete_expired_paid_unload_token_collection'];
        MembersNotifier: ['subscribe', 'unsubscribe', 'request_replay', 'enqueue_updates', 'send_batch', 'send_init_page', 'abandon_stuck_batch'];
        Airdrop: ['schedule_event', 'remove_scheduled_event', 'enable_asset', 'disable_asset', 'start_registration_authorized', 'close_registration_authorized', 'draw_winners_authorized', 'close_drawing_authorized', 'close_claiming_authorized', 'clean_up_registrations_authorized', 'clean_up_winners_authorized', 'finalize_authorized'];
        Honour: ['bestow'];
        MultiBlockMigrations: ['force_set_cursor', 'force_set_active_cursor', 'force_onboard_mbms', 'clear_historic'];
    };
    events: {
        System: ['ExtrinsicSuccess', 'ExtrinsicFailed', 'CodeUpdated', 'NewAccount', 'KilledAccount', 'Remarked', 'UpgradeAuthorized', 'RejectedInvalidAuthorizedUpgrade'];
        ParachainSystem: ['ValidationFunctionStored', 'ValidationFunctionApplied', 'ValidationFunctionDiscarded', 'DownwardMessagesReceived', 'DownwardMessagesProcessed', 'UpwardMessageSent'];
        Balances: ['Endowed', 'DustLost', 'Transfer', 'BalanceSet', 'Reserved', 'Unreserved', 'ReserveRepatriated', 'Deposit', 'Withdraw', 'Slashed', 'Minted', 'MintedCredit', 'Burned', 'BurnedDebt', 'Suspended', 'Restored', 'Upgraded', 'Issued', 'Rescinded', 'Locked', 'Unlocked', 'Frozen', 'Thawed', 'TotalIssuanceForced', 'Held', 'BurnedHeld', 'TransferOnHold', 'TransferAndHold', 'Released', 'Unexpected'];
        TransactionPayment: ['TransactionFeePaid'];
        SkipFeelessPayment: ['FeeSkipped'];
        OriginRestriction: ['UsageCleaned'];
        Assets: ['Created', 'Issued', 'Transferred', 'Burned', 'TeamChanged', 'OwnerChanged', 'Frozen', 'Thawed', 'AssetFrozen', 'AssetThawed', 'AccountsDestroyed', 'ApprovalsDestroyed', 'DestructionStarted', 'Destroyed', 'ForceCreated', 'MetadataSet', 'MetadataCleared', 'ApprovedTransfer', 'ApprovalCancelled', 'TransferredApproved', 'AssetStatusChanged', 'AssetMinBalanceChanged', 'Touched', 'Blocked', 'Deposited', 'Withdrawn', 'ReservesUpdated', 'ReservesRemoved', 'IssuedCredit', 'BurnedCredit', 'IssuedDebt', 'BurnedDebt'];
        AssetsHolder: ['Held', 'Released', 'Burned'];
        AssetRate: ['AssetRateCreated', 'AssetRateRemoved', 'AssetRateUpdated'];
        AssetTxPayment: ['AssetTxFeePaid'];
        CollatorSelection: ['NewInvulnerables', 'InvulnerableAdded', 'InvulnerableRemoved', 'NewDesiredCandidates', 'NewCandidacyBond', 'CandidateAdded', 'CandidateBondUpdated', 'CandidateRemoved', 'CandidateReplaced', 'InvalidInvulnerableSkipped'];
        Session: ['NewSession', 'NewQueued', 'ValidatorDisabled', 'ValidatorReenabled'];
        XcmpQueue: ['XcmpMessageSent'];
        PolkadotXcm: ['Attempted', 'Sent', 'SendFailed', 'ProcessXcmError', 'UnexpectedResponse', 'ResponseReady', 'Notified', 'NotifyOverweight', 'NotifyDispatchError', 'NotifyDecodeFailed', 'InvalidResponder', 'InvalidResponderVersion', 'ResponseTaken', 'AssetsTrapped', 'VersionChangeNotified', 'SupportedVersionChanged', 'NotifyTargetSendFail', 'NotifyTargetMigrationFail', 'InvalidQuerierVersion', 'InvalidQuerier', 'VersionNotifyStarted', 'VersionNotifyRequested', 'VersionNotifyUnrequested', 'FeesPaid', 'AssetsClaimed', 'VersionMigrationFinished', 'AliasAuthorized', 'AliasAuthorizationRemoved', 'AliasesAuthorizationsRemoved'];
        CumulusXcm: ['InvalidFormat', 'UnsupportedVersion', 'ExecutedDownward'];
        MessageQueue: ['ProcessingFailed', 'Processed', 'OverweightEnqueued', 'PageReaped'];
        Utility: ['BatchInterrupted', 'BatchCompleted', 'BatchCompletedWithErrors', 'ItemCompleted', 'ItemFailed', 'DispatchedAs', 'IfElseMainSuccess', 'IfElseFallbackCalled'];
        Multisig: ['NewMultisig', 'MultisigApproval', 'MultisigExecuted', 'MultisigCancelled', 'DepositPoked'];
        Sudo: ['Sudid', 'KeyChanged', 'KeyRemoved', 'SudoAsDone'];
        Proxy: ['ProxyExecuted', 'PureCreated', 'PureKilled', 'Announced', 'ProxyAdded', 'ProxyRemoved', 'DepositPoked'];
        Identity: ['IdentitySet', 'IdentityCleared', 'IdentityKilled', 'JudgementRequested', 'JudgementUnrequested', 'JudgementGiven', 'RegistrarAdded', 'SubIdentityAdded', 'SubIdentitiesSet', 'SubIdentityRenamed', 'SubIdentityRemoved', 'SubIdentityRevoked', 'AuthorityAdded', 'AuthorityRemoved', 'UsernameSet', 'UsernameQueued', 'PreapprovalExpired', 'PrimaryUsernameSet', 'DanglingUsernameRemoved', 'UsernameUnbound', 'UsernameRemoved', 'UsernameKilled', 'UsernameReported', 'PersonalIdentitySet', 'EvidenceSubmitted', 'CredentialAccepted', 'CredentialRejected', 'PersonBanned', 'PersonalIdentityCleared', 'ReportedUsernameJudgedValid', 'ReportedUsernameJudgedInvalid', 'ReportedUsernameWeakOrUnclearJudgement'];
        People: ['PersonhoodRecognized', 'PersonOnboarding', 'AliasDispatched', 'AliasAccountSet', 'AliasAccountUnset', 'PersonalIdAccountSet', 'PersonalIdAccountUnset', 'CollectionCreated', 'ForcePersonhoodRecognized', 'AliasCleanedUp'];
        MobRule: ['CaseCreated', 'Callback', 'CallbackError', 'CaseClosed', 'Voted', 'VoteCleaned', 'CaseRemoved', 'CaseIntervened', 'VotesClaimed', 'RewardPayout', 'PayoutRoundStarted', 'PayoutRoundsScheduled', 'PayoutScheduleRemoved', 'CreditClaimed', 'PointsCleaned', 'CaseTouched', 'VotingPenaltyCleared'];
        ProofOfInk: ['CandidateApplied', 'JudgementRequested', 'JudgementProvided', 'RetryGranted', 'PersonRegistered', 'CandidateReferred', 'Rerolled', 'DesignCommitted', 'FullyAllocated', 'TimedOut', 'FlakedOut', 'TicketReferred', 'TicketCancelled', 'TicketApplied', 'FamilyAdded', 'AllInvitesRemoved', 'SomeInvitesRemoved', 'InvitedCandidateApplied', 'ReferralVoucherRegistered', 'InvitesGranted', 'InviteTicketSet', 'InviteTicketCancelled', 'ConfigurationSet'];
        Game: ['NewGame', 'GameEnded', 'GameKilled', 'GamePhasesSet', 'SignedUp', 'ReportSubmitted', 'Offboarded', 'KickedOut', 'InvitesGranted', 'InviteTicketSet', 'InviteTicketCancelled', 'GamesScheduled', 'ScheduledGameRemoved', 'StmtUsageRemoved', 'AllInvitesRemoved', 'SomeInvitesRemoved', 'PlayDepositSet', 'AirdropScheduled', 'AirdropScheduleFailed', 'GameCancelled'];
        Score: ['CreditClaimed', 'PersonhoodRecognized', 'PayoutRoundsScheduled', 'PayoutScheduleRemoved', 'RoundTransitioned', 'PayoutRoundOperated', 'CashedOut', 'PersonhoodThresholdScheduleSet', 'AbsenceGraceScheduleSet'];
        DummyDim: ['IdsReserved', 'IdRenewed', 'IdUnreserved', 'PeopleRegistered', 'PeopleSuspended', 'PersonhoodResumed', 'SuspensionsStarted', 'SuspensionsEnded'];
        PeopleLite: ['AllAttestationAllowanceCleared', 'AttestationAllowanceIncreased', 'PersonAttested', 'ConsumerRegistered', 'AliasAccountSet', 'AliasAccountUnset'];
        Resources: ['PersonRegistered', 'LitePersonRegistered', 'FriendRequestStmtUsageSet', 'FriendRequestStmtUsageRemoved', 'PersonAuthorizationTouched', 'ExpiredUsernameReservationRemoved', 'IdentifierKeyUpdated', 'UsernameReservationDurationSet', 'StmtStoreAllowanceSet', 'StmtStoreAllowancesCleared', 'PersonDemoted', 'LongTermStorageClaimed', 'LongTermStorageAllocationFailed', 'LongTermStorageAliasesCleared'];
        ChunksManager: ['ChunkPageHashesInitialized', 'ChunksAdded'];
        Members: ['MemberAdded', 'MemberRemoved', 'CollectionMarkedForDeletion', 'CollectionDeleted', 'RingBuilt', 'MembersOnboarded', 'RingsMerged', 'OnboardingSizeSet', 'MemberSelfIncluded', 'OldRootCleanedUp'];
        Coinage: ['CoinSplit', 'CoinTransferred', 'RecyclerLoadedWithCoin', 'RecyclerLoadedWithExternalAsset', 'RecyclerUnloadedIntoCoin', 'RecyclerUnloadedIntoExternalAsset', 'RecyclerUnloadedIntoExternalAssetAndVouchers', 'PaidUnloadTokenRegisteredWithCoin', 'PaidUnloadTokenRegisteredWithNative', 'PaidUnloadTokenRegisteredWithStable', 'PeopleFreeUnloadTokenConsumed', 'LitePeopleFreeUnloadTokenConsumed', 'RecyclersUnloadedIntoCoin', 'RecyclersUnloadedIntoExternalAsset', 'RecyclersUnloadedIntoExternalAssetNonAnonymous', 'RecyclerUnloadedIntoCoins', 'CoinOffboardedIntoExternalAsset', 'RecyclerCleaned', 'ConsumedFreeTokensCleaned', 'PaidUnloadTokenRingCleaned', 'RecyclerDustCleaned', 'PaidUnloadTokenDustCleaned', 'ExpiredPaidUnloadTokenCollectionDeleted', 'UnderlyingAssetIdSet'];
        MembersNotifier: ['Subscribed', 'Unsubscribed', 'UpdatesSent', 'UpdateSendFailed', 'ReplayRequested', 'BatchAbandoned'];
        Airdrop: ['EventScheduled', 'ScheduledEventRemoved', 'EventCancelled', 'RegistrationStarted', 'AliasRegistered', 'AccountRegistered', 'DrawingWinners', 'ClaimingStarted', 'EventCanceled', 'PrizeClaimed', 'ClearingRegistrations', 'ClearingWinners', 'FinalizingEvent', 'EventCompleted', 'AssetEnabled', 'AssetDisabled'];
        Honour: ['VoteCast', 'VoteReused', 'HonourChanged'];
        StorageInitialization: ['AssetCreated', 'XcmFundsTransferSent', 'XcmFundsTransferTimedOut', 'FundsVerified', 'PotsFunded', 'PeopleLiteAttestationAllowancesSet', 'MobRulePayoutsScheduled', 'ScorePayoutsScheduled', 'OnPollInitializationCompleted', 'MigrationPeopleRecognized', 'MigrationOnboardingSizeSet', 'MigrationProofOfInkInitialized', 'MigrationGamesScheduled', 'MigrationInvitesGranted', 'MigrationReimbursementValuesSet', 'MigrationAttestationAllowancesSet', 'MigrationCompleted'];
        MultiBlockMigrations: ['UpgradeStarted', 'UpgradeCompleted', 'UpgradeFailed', 'MigrationSkipped', 'MigrationAdvanced', 'MigrationCompleted', 'MigrationFailed', 'HistoricCleared'];
    };
    errors: {
        System: ['InvalidSpecName', 'SpecVersionNeedsToIncrease', 'FailedToExtractRuntimeVersion', 'NonDefaultComposite', 'NonZeroRefCount', 'CallFiltered', 'MultiBlockMigrationsOngoing', 'NothingAuthorized', 'Unauthorized'];
        ParachainSystem: ['OverlappingUpgrades', 'ProhibitedByPolkadot', 'TooBig', 'ValidationDataNotAvailable', 'HostConfigurationNotAvailable', 'NotScheduled'];
        Balances: ['VestingBalance', 'LiquidityRestrictions', 'InsufficientBalance', 'ExistentialDeposit', 'Expendability', 'ExistingVestingSchedule', 'DeadAccount', 'TooManyReserves', 'TooManyHolds', 'TooManyFreezes', 'IssuanceDeactivated', 'DeltaZero'];
        OriginRestriction: ['NoUsage', 'NotZero'];
        Assets: ['BalanceLow', 'NoAccount', 'NoPermission', 'Unknown', 'Frozen', 'InUse', 'BadWitness', 'MinBalanceZero', 'UnavailableConsumer', 'BadMetadata', 'Unapproved', 'WouldDie', 'AlreadyExists', 'NoDeposit', 'WouldBurn', 'LiveAsset', 'AssetNotLive', 'IncorrectStatus', 'NotFrozen', 'CallbackFailed', 'BadAssetId', 'ContainsFreezes', 'ContainsHolds', 'TooManyReserves'];
        AssetsHolder: ['TooManyHolds'];
        AssetRate: ['UnknownAssetKind', 'AlreadyExists', 'Overflow'];
        CollatorSelection: ['TooManyCandidates', 'TooFewEligibleCollators', 'AlreadyCandidate', 'NotCandidate', 'TooManyInvulnerables', 'AlreadyInvulnerable', 'NotInvulnerable', 'NoAssociatedValidatorId', 'ValidatorNotRegistered', 'InsertToCandidateListFailed', 'RemoveFromCandidateListFailed', 'DepositTooLow', 'UpdateCandidateListFailed', 'InsufficientBond', 'TargetIsNotCandidate', 'IdenticalDeposit', 'InvalidUnreserve'];
        Session: ['InvalidProof', 'NoAssociatedValidatorId', 'DuplicatedKey', 'NoKeys', 'NoAccount'];
        XcmpQueue: ['BadQueueConfig', 'AlreadySuspended', 'AlreadyResumed', 'TooManyActiveOutboundChannels', 'TooBig'];
        PolkadotXcm: ['Unreachable', 'SendFailure', 'Filtered', 'UnweighableMessage', 'DestinationNotInvertible', 'Empty', 'CannotReanchor', 'TooManyAssets', 'InvalidOrigin', 'BadVersion', 'BadLocation', 'NoSubscription', 'AlreadySubscribed', 'CannotCheckOutTeleport', 'LowBalance', 'TooManyLocks', 'AccountNotSovereign', 'FeesNotMet', 'LockNotFound', 'InUse', 'InvalidAssetUnknownReserve', 'InvalidAssetUnsupportedReserve', 'TooManyReserves', 'LocalExecutionIncomplete', 'TooManyAuthorizedAliases', 'ExpiresInPast', 'AliasNotFound', 'LocalExecutionIncompleteWithError'];
        MessageQueue: ['NotReapable', 'NoPage', 'NoMessage', 'AlreadyProcessed', 'Queued', 'InsufficientWeight', 'TemporarilyUnprocessable', 'QueuePaused', 'RecursiveDisallowed'];
        Utility: ['TooManyCalls'];
        Multisig: ['MinimumThreshold', 'AlreadyApproved', 'NoApprovalsNeeded', 'TooFewSignatories', 'TooManySignatories', 'SignatoriesOutOfOrder', 'SenderInSignatories', 'NotFound', 'NotOwner', 'NoTimepoint', 'WrongTimepoint', 'UnexpectedTimepoint', 'MaxWeightTooLow', 'AlreadyStored'];
        Sudo: ['RequireSudo'];
        Proxy: ['TooMany', 'NotFound', 'NotProxy', 'Unproxyable', 'Duplicate', 'NoPermission', 'Unannounced', 'NoSelfProxy'];
        Identity: ['TooManySubAccounts', 'NoAlias', 'NotFound', 'NotNamed', 'EmptyIndex', 'FeeChanged', 'NoIdentity', 'StickyJudgement', 'JudgementGiven', 'InvalidJudgement', 'InvalidIndex', 'InvalidTarget', 'TooManyRegistrars', 'AlreadyClaimed', 'AlreadyReported', 'NotSub', 'NotOwned', 'JudgementForDifferentIdentity', 'JudgementPaymentFailed', 'InvalidSuffix', 'NotUsernameAuthority', 'NoAllocation', 'InvalidSignature', 'RequiresSignature', 'InvalidUsername', 'UsernameTaken', 'NoUsername', 'NotSystemProvidedUsername', 'NotExpired', 'TooEarly', 'NotUnbinding', 'AlreadyUnbinding', 'InsufficientPrivileges', 'BadContext', 'UnexpectedJudgement', 'NotSupported', 'Banned', 'AlreadyRegistered', 'JudgementListFull', 'LastUsernameReportTooRecent', 'UsernameJudgementOngoing'];
        People: ['NotPerson', 'NoKey', 'InvalidContext', 'InvalidAccount', 'AccountInUse', 'InvalidProof', 'InvalidSignature', 'NoMembers', 'Incomplete', 'StillFresh', 'TooManyMembers', 'KeyAlreadyInUse', 'KeyNotFound', 'CouldNotPush', 'SameKey', 'PersonalIdNotReserved', 'PersonalIdReservationCannotRenew', 'PersonalIdNotReservedOrNotRecognized', 'InvalidRing', 'SuspensionsPending', 'RingAboveMergeThreshold', 'InvalidSuspensions', 'NoMutationSession', 'CouldNotStartMutationSession', 'SuspensionSessionInProgress', 'AliasNotStale', 'TimeOutOfRange', 'AliasAccountAlreadySet', 'NotSuspended', 'Suspended', 'InvalidKeyMigration', 'KeyAlreadySuspended', 'InvalidOnboardingSize', 'InvalidMemberKey', 'PeopleCollectionAlreadyExists', 'AliasMismatch', 'NoStaleAliases'];
        MobRule: ['NoSuchCase', 'NoSuchVote', 'NotOpen', 'NotRipe', 'NotDone', 'CodecError', 'DispatchError', 'Recent', 'NoCredit', 'NoReward', 'NoPoints', 'TooManyClaims', 'NoPayout', 'ArithmeticOverflow', 'TooManySchedules', 'NoSchedule', 'NoPenalty', 'Early', 'UnderPenalty', 'CaseExpirationDisabled'];
        ProofOfInk: ['InProgress', 'NoReferral', 'BadContext', 'UnexpectedJudgement', 'NoArgs', 'NotApplied', 'NotSelected', 'NotProven', 'AlreadyStarted', 'OutOfRange', 'AlreadyTaken', 'NoMoreReferrals', 'TooEarly', 'DesignInvalid', 'DesignTaken', 'BadParent', 'BadFamily', 'WrongFamily', 'IndexTooBig', 'Busy', 'Banned', 'Improbable', 'IdReserved', 'IdUsed', 'InvalidTicket', 'NoTicket', 'NotAuthorized', 'NotPerson', 'ReferredCandidate', 'NotReferredCandidate', 'NoRewardToRegister', 'RewardToRegister', 'NoInviter', 'InvalidSignature', 'NoInvites', 'AlreadyInvited', 'NoReferrer', 'NotPoiPerson', 'InvalidProofOfOwnership', 'InvalidReimbursementValues'];
        Game: ['GameOngoing', 'NoRegistration', 'OutdatedGameSetup', 'InvalidGameSetup', 'InvalidReport', 'NoGame', 'NoReporting', 'NotRegistered', 'AlreadyRegistered', 'ReportAlreadySent', 'Early', 'NotKickablePlayer', 'NoArchivedPlayer', 'NoTicket', 'NoInvites', 'AlreadyInvited', 'NotAccountPlayer', 'UseInviteButAlreadyPlaying', 'TooManyGameSchedules', 'NoSuchGameScheduled', 'InvalidStatementAccountSignature', 'StatementAccountAlreadyInUse', 'InternalErrorInvalidState', 'InvalidGameState', 'NoPlayer', 'CannotOffboardWhileRegisteredForGame', 'InvalidState', 'InvalidPlayDeposit', 'InvalidAirdropVrfVariantForAccount', 'InvalidAirdropVrfVariantForRecognition', 'NotEligibleForAirdrop'];
        Score: ['NotPerson', 'HasNotReachedPersonhood', 'NoReward', 'NoScore', 'NoSchedule', 'TooManySchedules', 'Recognized', 'CashOutCooldown', 'RoundOnGoingOrNoSchedule', 'NoRound', 'BadOriginNotPersonNotSigned', 'BadOriginNotPersonNotSignedNotAccountParticipant', 'BadOriginNotSignedNotAccountParticipant', 'AlreadyParticipating', 'KeyMustBeProvided', 'KeyMustNotBeProvided', 'HasReachedPersonhood', 'InvalidProofOfOwnership', 'WindowTooLarge', 'AllowedMissesTooLarge', 'AbsenceScheduleNotSorted', 'PersonhoodScheduleEmpty', 'PersonhoodScoreThresholdZero', 'PersonhoodScoreThresholdTooLarge', 'PersonhoodScheduleNotSorted', 'PersonhoodScheduleNotMonotonic', 'PersonhoodScheduleNotTotal'];
        DummyDim: ['NotPerson', 'NotSuspended', 'NotReserved', 'TooManyPeople'];
        PeopleLite: ['NoAttestationAllowance', 'InvalidAttestationSignature', 'InvalidProofOfOwnership', 'AlreadyRegistered', 'KeyAlreadyInUse', 'AccountInUse', 'AliasAccountAlreadySet', 'AliasAccountNotSet', 'CallBlockOutOfRange', 'InvalidAliasContext', 'LitePeopleCollectionNotCreated'];
        Resources: ['InvalidUsername', 'UsernameTaken', 'AlreadyRegistered', 'InvalidProofOfOwnership', 'NotRegistered', 'NotFullPerson', 'TouchNotReady', 'NoReservation', 'NotReservationHolder', 'UsernameReservationTaken', 'ReservationFresh', 'NoLinkedIdentity', 'AlreadyLinked', 'PersonAuthNotExpired', 'AlreadyDemoted', 'QueueFull', 'NotInQueue', 'AlreadyHasReservation', 'InvalidFriendRequestSequence', 'InvalidFriendRequestPeriod', 'FriendRequestRegistrationNotExpired', 'FriendRequestRegistrationAlreadyExists', 'StmtStoreReplacementTooEarly', 'LongTermStorageCleanupLimitExceeded'];
        ChunksManager: ['ChunkNotFound', 'InvalidChunks', 'InvalidChunkRange'];
        Members: ['NotMember', 'NoRoot', 'InvalidProof', 'Incomplete', 'TooManyMembers', 'KeyAlreadyInUse', 'KeyNotFound', 'CouldNotPush', 'InvalidRing', 'SuspensionsPending', 'RingAboveMergeThreshold', 'InvalidSuspensions', 'NoRemovalSession', 'CouldNotStartRemovalSession', 'RemovalSessionInProgress', 'KeyAlreadySuspended', 'InvalidOnboardingSize', 'InvalidMemberKey', 'CollectionNotFound', 'CollectionAlreadyExists', 'TooManyCollections', 'InvalidRingSizeForFlexible', 'InvalidRingExponent', 'PrematureOnboarding', 'CollectionMarkedForDeletion', 'NotCollectionOwner', 'NotOnboarding', 'NothingToBuild'];
        Coinage: ['MemberKeyAlreadyUsed', 'InvalidMemberKey', 'InternalError', 'RecyclerAlreadyUnloaded', 'InvalidConsolidation', 'ConsolidationTooBig', 'CoinValueTooBig', 'CoinValueTooSmall', 'CoinValueIsLessThanFee', 'CoinValueOutOfBound', 'LossyCoinValueConversion', 'InvalidAliasProof', 'NoUnloadingRecycler', 'ProofAndAliasMismatch', 'NothingToBuild', 'TooManyRings', 'AddressAlreadyHasCoin', 'InvalidProofOfOwnership', 'EmptyInputs', 'RecyclerMismatch', 'InsufficientUnloadForFee', 'AliasNotPremarked', 'InvalidRecyclerRevision', 'InvalidSplit', 'FreshCoinRequired', 'CannotConvertNativeToAsset', 'MaxFeeNotAllowedForPrepaid', 'MaxFeeExceedsInput', 'InvalidMaxFee', 'CannotCreateRecyclerCollection', 'AssetIdNotSet', 'AssetIdAlreadySet', 'UnknownAsset'];
        MembersNotifier: ['SubscriberNotFound', 'AlreadySubscribed', 'TooManySubscribers', 'InvalidCollectionsList', 'TooManyUpdates', 'XcmSendFailed', 'NotSubscribedToCollection', 'InvalidRingIndex', 'ExceedsChannelCapacity', 'NoBatchActive', 'NoPendingInit', 'ReplayCooldownActive', 'EmptyRingIndices'];
        Airdrop: ['PrizeBelowMinBalance', 'NoWinnersConfigured', 'TooManyWinners', 'InvalidEventTimes', 'DuplicateEventId', 'NoScheduledEvent', 'UnknownEvent', 'WrongStatus', 'NotAcceptingRegistrations', 'NotClaiming', 'ClaimingWindowClosed', 'EntropySlotTaken', 'InvalidVrfProof', 'UnsupportedAccountKey', 'InvalidMembershipProof', 'NoSuchWinner', 'ParticipantOverflow', 'PrizeAllocationOverflow', 'AssetNotEnabled', 'AssetAlreadyEnabled'];
        Honour: ['Arithmetic', 'SubjectAlreadyVoted', 'InvalidProof'];
        MultiBlockMigrations: ['Ongoing'];
    };
    constants: {
        System: ['BlockWeights', 'BlockLength', 'BlockHashCount', 'DbWeight', 'Version', 'SS58Prefix'];
        ParachainSystem: ['SelfParaId'];
        Timestamp: ['MinimumPeriod'];
        Balances: ['ExistentialDeposit', 'MaxLocks', 'MaxReserves', 'MaxFreezes'];
        TransactionPayment: ['OperationalFeeMultiplier'];
        Assets: ['RemoveItemsLimit', 'AssetDeposit', 'AssetAccountDeposit', 'MetadataDepositBase', 'MetadataDepositPerByte', 'ApprovalDeposit', 'StringLimit'];
        CollatorSelection: ['PotId', 'MaxCandidates', 'MinEligibleCollators', 'MaxInvulnerables', 'KickThreshold', 'pot_account'];
        Session: ['KeyDeposit'];
        Aura: ['SlotDuration'];
        XcmpQueue: ['MaxInboundSuspended', 'MaxActiveOutboundChannels', 'MaxPageSize'];
        PolkadotXcm: ['UniversalLocation', 'AdvertisedXcmVersion', 'MaxLockers', 'MaxRemoteLockConsumers'];
        MessageQueue: ['HeapSize', 'MaxStale', 'ServiceWeight', 'IdleMaxServiceWeight'];
        Utility: ['batched_calls_limit'];
        Multisig: ['DepositBase', 'DepositFactor', 'MaxSignatories'];
        Proxy: ['ProxyDepositBase', 'ProxyDepositFactor', 'MaxProxies', 'MaxPending', 'AnnouncementDepositBase', 'AnnouncementDepositFactor'];
        Identity: ['BasicDeposit', 'ByteDeposit', 'UsernameDeposit', 'SubAccountDeposit', 'UsernameReportDeposit', 'MaxSubAccounts', 'UsernameReportTimeout', 'MaxRegistrars', 'MaxJudgements', 'PendingUsernameExpiration', 'UsernameGracePeriod', 'MaxSuffixLength', 'MaxUsernameLength', 'MinUsernameLength', 'CredentialRemovalPenalty', 'identity_context'];
        People: ['RingExponent', 'OnboardingQueuePageSize', 'StaleAliasCleanupInterval', 'account_setup_time_tolerance'];
        MobRule: ['CurrencyLocationInfo', 'MaxVoteClaimDuration', 'MinCaseDuration', 'MaxVotingDuration', 'MinTurnoutNominal', 'MinTurnoutPercentage', 'VotingPenaltyDuration', 'MaxVotesClaimable', 'OffchainWorkInterval', 'CleanVotesBatchSize', 'VotesOpenForClaimsDuration', 'MinimumVoterThreshold', 'mob_rule_pot_id', 'mob_rule_context'];
        ProofOfInk: ['MaxActiveReferrals', 'PotId', 'proof_of_ink_pot_id'];
        Game: ['MaxRounds', 'MaxGroupSize', 'MinGroupSize', 'NonPlayingKickoutTime', 'DefaultPlayDeposit', 'DefaultPhaseDurations', 'MaxGameSchedules', 'MaxAttendanceHistoryDepth', 'AirdropSource', 'proof_of_ownership_msg_base', 'max_enactments', 'airdrop_event_id_base'];
        Score: ['CurrencyLocationInfo', 'OffchainWorkInterval', 'score_pot_id', 'score_context'];
        PeopleLite: ['LiteRingExponent', 'LiteOnboardingSize', 'account_setup_block_tolerance'];
        Resources: ['MaxUsernameLength', 'MinUsernameLength', 'PersonAuthDuration', 'MinPersonAuthUpdateInterval', 'MaxReservationQueueLength', 'AccountsApiAllowance', 'StmtStoreSlotsPerPeriod', 'LiteStmtStoreSlotsPerPeriod', 'StmtStoreCleanupLimit', 'StmtStoreReplacementCooldown', 'StmtStoreGraceWindow', 'FriendRequestAllowance', 'FriendRequestSlotsPerPeriod', 'LiteFriendRequestSlotsPerPeriod', 'FriendRequestPeriodDuration', 'FriendRequestGraceWindow', 'FriendRequestRetentionDuration', 'OffchainWorkerInterval', 'LongTermStoragePeriodDuration', 'LongTermStorageClaimsPerPeriod', 'LongTermStorageGraceWindow', 'LongTermStorageCleanupLimit'];
        ChunksManager: ['PageSize'];
        Members: ['MaxCollections', 'OnboardingQueuePageSize', 'MaxFlexibleRingExponent', 'RingBuildingMemberLimit', 'OldRootRetentionDuration', 'OffchainWorkerInterval'];
        Coinage: ['RecyclerRingExponent', 'PaidUnloadTokenRingExponent', 'UnderlyingAssetUnit', 'MinimumExponent', 'MaximumExponent', 'MinimumExponentForOutputUnloadFee', 'MaxSplitOutputs', 'MaxConsolidation', 'MaxBatchUnpaidLoad', 'UnloadTokenTimePeriodPeopleLitePeople', 'UnloadTokenAllowancePerTimePeriodForPeople', 'UnloadTokenAllowancePerTimePeriodForLitePeople', 'MaxFreeUnloadTokensPerTimePeriod', 'OffchainWorkerInterval', 'CoinFailureLockPeriod', 'pallet_account'];
        MembersNotifier: ['MaxSubscribers', 'MaxUpdatesPerBatch', 'MaxCollectionsPerSubscriber', 'MaxCollections', 'UpdateTriggerBlocks', 'UpdateTriggerThreshold', 'RequestReplayRemoteWeight', 'OffchainWorkerInterval', 'StuckBatchTimeout', 'ReplayCooldownSeconds'];
        Airdrop: ['PalletId', 'ClearLimit', 'DrawLimit', 'OffchainWorkerInterval', 'airdrop_pot_id'];
        Honour: ['PointFreezeDuration', 'CallMortality'];
        MultiBlockMigrations: ['CursorMaxLen', 'IdentifierMaxLen'];
    };
    viewFns: {
        Assets: ['asset_details', 'balance_of', 'get_metadata', 'get_reserves_data'];
        Proxy: ['check_permissions', 'is_superset'];
        Resources: ['current_stmt_store_period', 'stmt_store_slot_context_for', 'friend_request_context_for'];
        Coinage: ['get_free_unload_token_info', 'get_recycler_ring_status', 'get_recycler_ring_revision', 'get_paid_token_ring_status', 'get_paid_token_ring_revision', 'get_paid_unload_token_fee_in_asset', 'get_paid_unload_token_fee_in_native', 'get_coin_by_owner', 'get_coin_lock_until', 'get_recycler_member_info', 'is_paid_token_member', 'get_recycler_members', 'get_paid_token_ring_members', 'is_recycler_alias_unloaded', 'is_paid_token_alias_consumed', 'is_free_token_alias_consumed', 'weight_for_unload_recycler_paying_using_output'];
        MultiBlockMigrations: ['ongoing_status', 'progress', 'affected_prefixes', 'status'];
    };
    apis: {
        AuraApi: ['slot_duration', 'authorities'];
        RelayParentOffsetApi: ['relay_parent_offset'];
        AuraUnincludedSegmentApi: ['can_build_upon'];
        Core: ['version', 'execute_block', 'initialize_block'];
        Metadata: ['metadata', 'metadata_at_version', 'metadata_versions'];
        RuntimeViewFunction: ['execute_view_function'];
        BlockBuilder: ['apply_extrinsic', 'finalize_block', 'inherent_extrinsics', 'check_inherents'];
        TaggedTransactionQueue: ['validate_transaction'];
        OffchainWorkerApi: ['offchain_worker'];
        SessionKeys: ['generate_session_keys', 'decode_session_keys'];
        AccountNonceApi: ['account_nonce'];
        TransactionPaymentApi: ['query_info', 'query_fee_details', 'query_weight_to_fee', 'query_length_to_fee'];
        TransactionPaymentCallApi: ['query_call_info', 'query_call_fee_details', 'query_weight_to_fee', 'query_length_to_fee'];
        XcmPaymentApi: ['query_acceptable_payment_assets', 'query_xcm_weight', 'query_weight_to_asset_fee', 'query_delivery_fees'];
        DryRunApi: ['dry_run_call', 'dry_run_xcm'];
        LocationToAccountApi: ['convert_location'];
        MobRuleApi: ['voted_on'];
        ProofOfInkApi: ['candidacy_deposit'];
        PalletGameApi: ['play_deposit'];
        CollectCollationInfo: ['collect_collation_info'];
        GenesisBuilder: ['build_state', 'get_preset', 'preset_names'];
    };
};
export type PaseoPeopleNextWhitelistEntry = PalletKey | `query.${NestedKey<AllInteractions['storage']>}` | `tx.${NestedKey<AllInteractions['tx']>}` | `event.${NestedKey<AllInteractions['events']>}` | `error.${NestedKey<AllInteractions['errors']>}` | `const.${NestedKey<AllInteractions['constants']>}` | `view.${NestedKey<AllInteractions['viewFns']>}` | `api.${NestedKey<AllInteractions['apis']>}`;
type PalletKey = `*.${({
    [K in keyof AllInteractions]: K extends 'apis' ? never : keyof AllInteractions[K];
})[keyof AllInteractions]}`;
type NestedKey<D extends Record<string, string[]>> = "*" | {
    [P in keyof D & string]: `${P}.*` | `${P}.${D[P][number]}`;
}[keyof D & string];
